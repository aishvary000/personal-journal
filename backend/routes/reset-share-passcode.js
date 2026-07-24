
// routes/reset-share-passcode.js
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

function generatePasscode() {
  return crypto.randomInt(100000, 1000000).toString();
}

// POST /api/shares/:shareId/reset-passcode  (behind requireAuth)
// Issues a brand-new passcode for an existing collection — the share link
// (share_url) stays exactly the same, only the passcode changes, and any
// previously-issued passcode for this collection stops working immediately.
export async function resetSharePasscodeHandler(req, res) {
  try {
    const { shareId } = req.params;

    const passcode = generatePasscode();
    const passcodeHash = await bcrypt.hash(passcode, 12);

    const { data, error } = await supabase
      .from('shares')
      .update({ passcode_hash: passcodeHash })
      .eq('id', shareId)
      .select('id, collection_name, share_url')
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'share not found' });
    }

    res.json({
      share_id: data.id,
      collection_name: data.collection_name,
      url: data.share_url,
      passcode, // shown once, same as at creation time
    });
  } catch (err) {
    console.error('resetSharePasscodeHandler failed:', err);
    res.status(500).json({ error: 'internal error' });
  }
}
