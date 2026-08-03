
// routes/osmo-photos.js
import { createClient } from '@supabase/supabase-js';
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

// GET /api/osmo/photos?limit=20&offset=0  (behind requireAuth)
export async function osmoPhotosHandler(req, res) {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const { data, error, count } = await supabase
      .from('photos')
      .select('id, taken_at, media_type, thumb_key, b2_key', { count: 'exact' })
      .eq('source', 'osmo')
      .order('taken_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('Failed to list osmo photos:', error.message);
      return res.status(500).json({ error: 'failed to list photos' });
    }

    const results = data.map((row) => ({
      id: row.id,
      taken_at: row.taken_at,
      media_type: row.media_type,
      thumb_url: signPhotoUrl(row.thumb_key || row.b2_key),
      full_url: signPhotoUrl(row.b2_key),
      download_url: signPhotoUrl(row.b2_key, { download: true }),
    }));

    res.json({ photos: results, total: count, has_more: offset + results.length < count });
  } catch (err) {
    console.error('osmoPhotosHandler failed:', err);
    res.status(500).json({ error: 'internal error' });
  }
}
