
// routes/transactions.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function learnMerchantCategory(merchant, category) {
  if (!merchant || !category || category === 'Uncategorized') return;
  const normalized = merchant.trim().toLowerCase();
  await supabase
    .from('merchant_category_map')
    .upsert({ merchant_pattern: normalized, category }, { onConflict: 'merchant_pattern' });
}

// GET /api/finance/transactions?needs_review=true&limit=20&offset=0
export async function listTransactionsHandler(req, res) {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const needsReviewOnly = req.query.needs_review === 'true';

    let query = supabase
      .from('transactions')
      .select('*', { count: 'exact' })
      .order('transaction_date', { ascending: false })
      .range(offset, offset + limit - 1);

    if (needsReviewOnly) query = query.eq('needs_review', true);

    const { data, error, count } = await query;
    if (error) return res.status(500).json({ error: 'failed to list transactions' });

    res.json({ transactions: data, total: count, has_more: offset + data.length < count });
  } catch (err) {
    console.error('listTransactionsHandler failed:', err);
    res.status(500).json({ error: 'internal error' });
  }
}

// PATCH /api/finance/transactions/:id
// body: { amount?, merchant?, category?, direction?, payment_method? }
// Editing the category also teaches merchant_category_map — future SMS from
// this same merchant get correctly categorized automatically, no LLM needed.
export async function updateTransactionHandler(req, res) {
  try {
    const { id } = req.params;
    const updates = req.body;

    const allowedFields = ['amount', 'merchant', 'category', 'direction', 'payment_method'];
    const filteredUpdates = Object.fromEntries(
      Object.entries(updates).filter(([key]) => allowedFields.includes(key))
    );

    if (Object.keys(filteredUpdates).length === 0) {
      return res.status(400).json({ error: 'no valid fields to update' });
    }

    // once a human has confirmed/corrected it, it's no longer low-confidence
    filteredUpdates.confidence = 'manual';
    filteredUpdates.needs_review = false;

    const { data, error } = await supabase
      .from('transactions')
      .update(filteredUpdates)
      .eq('id', id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: 'failed to update transaction' });

    // teach the map from this correction — this is the feedback loop that
    // makes categorization improve the more you use it
    if (filteredUpdates.category && data.merchant) {
      await learnMerchantCategory(data.merchant, filteredUpdates.category);
    }

    res.json({ transaction: data });
  } catch (err) {
    console.error('updateTransactionHandler failed:', err);
    res.status(500).json({ error: 'internal error' });
  }
}