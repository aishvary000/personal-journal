// routes/moments.js
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

// GET /api/moments?limit=20&offset=0
export async function listMomentsHandler(req, res) {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const { data: clusters, error, count } = await supabase
      .from('clusters')
      .select('id, start_date, end_date, photo_count, cover_photo_id, place_name, center_latitude, center_longitude', { count: 'exact' })
      .order('start_date', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('Failed to list moments:', error.message);
      return res.status(500).json({ error: 'failed to list moments' });
    }

    // Fetch all the cover photos in one extra query, rather than relying on
    // a join against Supabase's auto-generated (unpredictable) FK constraint name
    const coverPhotoIds = clusters.map((c) => c.cover_photo_id).filter(Boolean);
    const { data: coverPhotos } = await supabase
      .from('photos')
      .select('id, thumb_key, b2_key')
      .in('id', coverPhotoIds);

    const coverPhotoById = Object.fromEntries((coverPhotos || []).map((p) => [p.id, p]));

    const results = clusters.map((row) => {
      const cover = coverPhotoById[row.cover_photo_id];
      return {
        id: row.id,
        start_date: row.start_date,
        end_date: row.end_date,
        photo_count: row.photo_count,
        place_name: row.place_name,
        cover_thumb_url: cover ? signPhotoUrl(cover.thumb_key || cover.b2_key) : null,
      };
    });

    res.json({ moments: results, total: count, has_more: offset + results.length < count });
  } catch (err) {
    console.error('listMomentsHandler failed:', err);
    res.status(500).json({ error: 'internal error' });
  }
}

// GET /api/moments/:clusterId/photos
export async function momentPhotosHandler(req, res) {
  try {
    const { clusterId } = req.params;

    const { data, error } = await supabase
      .from('photos')
      .select('id, taken_at, media_type, thumb_key, b2_key')
      .eq('cluster_id', clusterId)
      .order('taken_at', { ascending: true });

    if (error) {
      console.error('Failed to fetch moment photos:', error.message);
      return res.status(500).json({ error: 'failed to fetch photos' });
    }

    const results = data.map((row) => ({
      id: row.id,
      taken_at: row.taken_at,
      media_type: row.media_type,
      thumb_url: signPhotoUrl(row.thumb_key || row.b2_key),
      full_url: signPhotoUrl(row.web_video_key || row.b2_key),
      download_url: signPhotoUrl(row.b2_key, { download: true }),
    }));

    res.json({ photos: results });
  } catch (err) {
    console.error('momentPhotosHandler failed:', err);
    res.status(500).json({ error: 'internal error' });
  }
}
