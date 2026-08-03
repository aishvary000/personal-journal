
// routes/ingest-sms.js
//
// FINAL design: every SMS is parsed by Claude (Haiku 4.5), every time.
// A prior version cached auto-generated regex per sender to skip the LLM
// call once a format was "learned" — this was removed after a concrete
// failure: a generated regex validated successfully against its own seed
// example (self-consistency) but was structurally wrong, extracting the
// word "is" as a merchant name from "...Acct XX379 is credited...". That
// wrong value got taught into merchant_category_map, marked high-confidence,
// and silently corrupted every future occurrence of that message format —
// exactly the risk of caching an extraction MECHANISM rather than a
// confirmed JUDGMENT. Validation-against-self proves consistency, not
// correctness, and a wrong original extraction poisons everything built on
// top of it while looking trustworthy the whole time.
//
// The one thing that IS still cached: merchant → category
// (merchant_category_map). That's a fundamentally safer thing to cache —
// worst case, a wrong category is a minor inconvenience you notice and fix,
// not a fabricated merchant name silently propagating with high confidence.

import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import crypto from 'crypto';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// A sensible starting taxonomy — merged with whatever's already been
// learned via merchant_category_map. Without this, a freshly truncated (or
// brand new) map starts completely empty, meaning the LLM's prompt would
// only ever offer "Uncategorized" as a choice — a genuine bootstrapping
// trap, since nothing ever gets taught while everything stays Uncategorized.
const DEFAULT_CATEGORIES = [
  'Food & Dining', 'Groceries', 'Transport', 'Shopping', 'Utilities/Bills',
  'Rent/EMI', 'Investments', 'Entertainment', 'Health', 'Transfers',
  'Income', 'Mobile Recharge', 'Insurance', 'Fuel',
];

function computeTransactionHash(sender, body, timestamp) {
  return crypto.createHash('sha256').update(`${sender}|${body}|${timestamp}`).digest('hex');
}

// --- The single, primary extraction call — used for every message, always ---
async function extractTransaction(rawText, knownCategories) {
  try {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [
        {
          role: 'user',
          content: `This SMS may or may not be an actual financial transaction (it could be a balance update, an OTP, an offer, a reminder, or something unrelated that just happens to mention an amount). Extract details. Respond with ONLY a JSON object, no other text:
{"is_transaction": true or false, "amount": number or null, "direction": "debit"|"credit"|null, "payment_method": "upi"|"credit_card"|"debit_card"|"unknown", "merchant": string or null, "suggested_category": one of [${knownCategories.join(', ')}, "Uncategorized"]}

Notes:
- merchant should be the actual payee/merchant name, never a phone number, a filler word from surrounding sentence structure (like "is" or "on"), "Not you?" block-instructions text, or other boilerplate footer content.
- If is_transaction is false, other fields can be null.

SMS: "${rawText}"`,
        },
      ],
    });

    const textBlock = message.content?.find((block) => block.type === 'text');
    if (!textBlock?.text) {
      console.warn('LLM response had no text block:', JSON.stringify(message.content));
      return null;
    }

    const responseText = textBlock.text
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();

    return JSON.parse(responseText);
  } catch (err) {
    console.warn('extractTransaction failed:', err.message);
    return null;
  }
}

async function findCategoryForMerchant(merchant) {
  if (!merchant) return null;
  const normalized = merchant.trim().toLowerCase();
  const { data } = await supabase
    .from('merchant_category_map')
    .select('category')
    .eq('merchant_pattern', normalized)
    .maybeSingle();
  return data?.category || null;
}

// Teaches the mapping table so the SAME merchant is trusted (high
// confidence) next time — called after a user confirms/corrects a
// low-confidence entry in the review UI, or on first successful LLM
// categorization (still flagged for review once, then trusted after).
async function learnMerchantCategory(merchant, category) {
  if (!merchant || !category || category === 'Uncategorized') return;
  const normalized = merchant.trim().toLowerCase();
  await supabase
    .from('merchant_category_map')
    .upsert({ merchant_pattern: normalized, category }, { onConflict: 'merchant_pattern' });
}

// POST /api/admin/ingest-sms  (shared secret, same pattern as ingest-photos)
// body: { sender: "AX-HDFCBK", body: "Rs.500 debited...", timestamp: "2026-...Z" }
export async function ingestSmsHandler(req, res) {
  const secret = req.headers['x-ingest-secret'];
  if (secret !== process.env.INGEST_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const { sender, body, timestamp } = req.body;
  if (!body) return res.status(400).json({ error: 'body is required' });

  res.status(200).json({ accepted: true }); // respond fast, process after

  try {
    const rawTextHash = computeTransactionHash(sender, body, timestamp || '');

    // Check for an existing row FIRST — before spending an LLM call on
    // something that's already been processed. Matters specifically for
    // re-running a backfill: without this, every already-ingested message
    // would still trigger a fresh LLM call, only to be silently discarded
    // by the upsert's ignoreDuplicates at the very end.
    const { data: existing } = await supabase
      .from('transactions')
      .select('id')
      .eq('raw_text_hash', rawTextHash)
      .maybeSingle();

    if (existing) {
      console.log(`⏭ Already processed, skipping LLM call: ${sender}`);
      return;
    }

    const { data: categories } = await supabase.from('merchant_category_map').select('category').limit(50);
    const learnedCategories = (categories || []).map((c) => c.category);
    const knownCategories = [...new Set([...DEFAULT_CATEGORIES, ...learnedCategories])];

    const extracted = await extractTransaction(body, knownCategories);

    if (!extracted) {
      console.warn(`Extraction failed entirely for SMS from ${sender} — skipping`);
      return;
    }

    if (extracted.is_transaction === false) {
      console.log(`⏭ Skipped (not a transaction) from ${sender}: "${body.slice(0, 60)}..."`);
      return;
    }

    // Confidence is about the MERCHANT, not the extraction mechanism —
    // "have I seen and confirmed this merchant before" is a more honest
    // trust signal than "did extraction happen to succeed."
    const knownCategory = await findCategoryForMerchant(extracted.merchant);
    const isTrustedMerchant = Boolean(knownCategory);

    const category = knownCategory || extracted.suggested_category || 'Uncategorized';

    // First time seeing this merchant with a real category — teach the map,
    // but still flag for review this once, so a wrong first guess gets
    // caught and corrected before it's trusted for every future occurrence.
    if (!isTrustedMerchant && category !== 'Uncategorized') {
      await learnMerchantCategory(extracted.merchant, category);
    }

    const { error: upsertError } = await supabase.from('transactions').upsert(
      {
        amount: extracted.amount,
        direction: extracted.direction,
        payment_method: extracted.payment_method,
        merchant: extracted.merchant,
        category,
        source: 'sms',
        raw_text: body,
        raw_text_hash: rawTextHash,
        sms_sender: sender,
        transaction_date: timestamp || new Date().toISOString(),
        confidence: isTrustedMerchant ? 'high' : 'low',
        needs_review: !isTrustedMerchant,
        extraction_method: 'llm',
      },
      { onConflict: 'raw_text_hash', ignoreDuplicates: true }
    );

    if (upsertError) {
      console.error('Failed to upsert transaction:', upsertError.message);
      return;
    }

    console.log(
      `✓ Ingested SMS from ${sender}: ${extracted.amount} (${isTrustedMerchant ? 'high' : 'low'} confidence, merchant: ${extracted.merchant})`
    );
  } catch (err) {
    console.error('SMS ingestion failed:', err);
  }
}
 