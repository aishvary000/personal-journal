
// routes/photos-in-range.js
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

function signPhotoUrl(key, { download = false, expiresInSeconds = 300 } = {}) {
  const expires = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const payload = `${key}:${expires}`; // download flag is NOT part of the signed payload —
                                        // it only affects a response header, not which
                                        // object gets served, so it doesn't need signing
  const signature = crypto
    .createHmac('sha256', process.env.PHOTO_SIGNING_SECRET)
    .update(payload)
    .digest('hex');
  const downloadParam = download ? '&download=true' : '';
  return `https://photos.aishvary.dev/${key}?expires=${expires}&sig=${signature}${downloadParam}`;
}

function isValidDateString(str) {
  return /^\d{4}-\d{2}-\d{2}$/.test(str) && !isNaN(new Date(str).getTime());
}

// GET /api/photos?start=YYYY-MM-DD&end=YYYY-MM-DD
export async function photosInRangeHandler(req, res) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const start = req.query.start || today;
    const end = req.query.end || start;

    if (!isValidDateString(start) || !isValidDateString(end)) {
      return res.status(400).json({ error: 'start/end must be valid dates in YYYY-MM-DD format' });
    }
    if (new Date(start) > new Date(end)) {
      return res.status(400).json({ error: 'start date must be before or equal to end date' });
    }

    const { data, error } = await supabase.rpc('photos_in_range', {
      start_date: start,
      end_date: end,
    });

    if (error) {
      console.error('RPC photos_in_range failed:', error.message);
      return res.status(500).json({ error: 'failed to fetch photos' });
    }

    const now = new Date();

    const results = data
      .filter((row) => row.media_type !== 'video')
      .map((row) => ({
        id: row.id,
        taken_at: row.taken_at,
        years_ago: now.getFullYear() - new Date(row.taken_at).getFullYear(),
        // grid view — small, fast to load
        thumb_url: signPhotoUrl(row.thumb_key || row.b2_key),
        // click-through — full resolution, displayed inline in a new tab
        full_url: signPhotoUrl(row.b2_key),
        // explicit download button — same file, but forces a save-dialog
        download_url: signPhotoUrl(row.b2_key, { download: true }),
      }));

    res.json({ start, end, count: results.length, photos: results });
  } catch (err) {
    console.error('photos-in-range handler failed:', err);
    res.status(500).json({ error: 'internal error' });
  }
}

