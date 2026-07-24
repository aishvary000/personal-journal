
// routes/create-share.js
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// crypto.randomInt is cryptographically secure — unlike Math.random(), which
// isn't safe for anything security-relevant (same reasoning as using
// crypto.randomBytes for session tokens earlier in this project).
function generatePasscode() {
  return crypto.randomInt(100000, 1000000).toString(); // always exactly 6 digits: 100000–999999
}

// POST /api/shares  (behind requireAuth — only you can create shares)
// body: { photo_ids: [1, 2, 3], collection_name: "Goa trip", expires_in_days?: 7 }
export async function createShareHandler(req, res) {
  try {
    const { photo_ids, collection_name, expires_in_days } = req.body;

    if (!Array.isArray(photo_ids) || photo_ids.length === 0) {
      return res.status(400).json({ error: 'photo_ids must be a non-empty array' });
    }

    const passcode = generatePasscode();
    const passcodeHash = await bcrypt.hash(passcode, 12);
    const expiresAt = (expires_in_days === null || expires_in_days === undefined)
      ? null
      : new Date(Date.now() + expires_in_days * 24 * 60 * 60 * 1000).toISOString();

    // Generate the id ourselves up front so we can store the full URL in the
    // same insert, rather than needing a second update after the fact.
    const shareId = crypto.randomUUID();
    const shareUrl = `${process.env.FRONTEND_URL}/share/${shareId}`;

    const { data, error } = await supabase
      .from('shares')
      .insert({
        id: shareId,
        photo_ids,
        passcode_hash: passcodeHash,
        expires_at: expiresAt,
        collection_name: collection_name?.trim() || 'Untitled share',
        share_url: shareUrl,
      })
      .select('id')
      .single();

    if (error) {
      console.error('Failed to create share:', error.message);
      return res.status(500).json({ error: 'failed to create share' });
    }

    // passcode is returned ONLY here, once, right after creation — it's never
    // stored anywhere in plaintext (only passcode_hash lives in the DB), so
    // this response is the one and only place to see it.
    res.json({
      share_id: data.id,
      url: shareUrl,
      passcode,
    });
  } catch (err) {
    console.error('createShareHandler failed:', err);
    res.status(500).json({ error: 'internal error' });
  }
}
