
// routes/unlock-share.js
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

function signPhotoUrl(key, { download = false, expiresInSeconds = 300 } = {}) {
  const expires = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const payload = `${key}:${expires}`;
  const signature = crypto
    .createHmac('sha256', process.env.PHOTO_SIGNING_SECRET)
    .update(payload)
    .digest('hex');
  const downloadParam = download ? '&download=true' : '';
  return `https://photos.aishvary.dev/${key}?expires=${expires}&sig=${signature}${downloadParam}`;
}

// POST /api/shares/:shareId/unlock  (PUBLIC — no login required, this is what
// the person you shared the link with actually calls)
// body: { passcode: "1234" }
export async function unlockShareHandler(req, res) {
  try {
    const { shareId } = req.params;
    const { passcode } = req.body;

    if (!passcode) {
      return res.status(400).json({ error: 'passcode required' });
    }

    const { data: share, error } = await supabase
      .from('shares')
      .select('id, photo_ids, passcode_hash, expires_at')
      .eq('id', shareId)
      .single();

    if (error || !share) {
      return res.status(404).json({ error: 'share not found' });
    }

    if (share.expires_at && new Date(share.expires_at) < new Date()) {
      return res.status(410).json({ error: 'this link has expired' });
    }

    const match = await bcrypt.compare(String(passcode), share.passcode_hash);
    if (!match) {
      return res.status(401).json({ error: 'incorrect passcode' });
    }

    const { data: photos, error: photosError } = await supabase
      .from('photos')
      .select('id, b2_key, thumb_key, taken_at, media_type')
      .in('id', share.photo_ids);

    if (photosError) {
      console.error('Failed to fetch shared photos:', photosError.message);
      return res.status(500).json({ error: 'failed to load photos' });
    }

    const results = photos.map((row) => ({
      id: row.id,
      taken_at: row.taken_at,
      media_type: row.media_type,
      thumb_url: signPhotoUrl(row.thumb_key || row.b2_key),
      full_url: signPhotoUrl(row.b2_key),
      download_url: signPhotoUrl(row.b2_key, { download: true }),
    }));

    res.json({ photos: results });
  } catch (err) {
    console.error('unlockShareHandler failed:', err);
    res.status(500).json({ error: 'internal error' });
  }
}