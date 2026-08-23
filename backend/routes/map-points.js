
// routes/map-points.js
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

function signPhotoUrl(key, expiresInSeconds = 300) {
  const expires = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const payload = `${key}:${expires}`;
  const signature = crypto.createHmac('sha256', process.env.PHOTO_SIGNING_SECRET).update(payload).digest('hex');
  return `https://photos.aishvary.dev/${key}?expires=${expires}&sig=${signature}`;
}

// GET /api/moments/map-points  (behind requireAuth)
// One point per cluster that has a known location — used to plot pins on
// the map view, rather than one pin per individual photo (which would be
// visually overwhelming and slow with a large library).
export async function mapPointsHandler(req, res) {
  try {
    const { data: clusters, error } = await supabase
      .from('clusters')
      .select('id, place_name, center_latitude, center_longitude, start_date, end_date, photo_count, cover_photo_id')
      .not('center_latitude', 'is', null);

    if (error) return res.status(500).json({ error: 'failed to load map points' });

    const coverPhotoIds = clusters.map((c) => c.cover_photo_id).filter(Boolean);
    const { data: coverPhotos } = await supabase
      .from('photos')
      .select('id, thumb_key, b2_key')
      .in('id', coverPhotoIds);

    const coverById = Object.fromEntries((coverPhotos || []).map((p) => [p.id, p]));

    const points = clusters.map((c) => {
      const cover = coverById[c.cover_photo_id];
      return {
        id: c.id,
        place_name: c.place_name,
        latitude: c.center_latitude,
        longitude: c.center_longitude,
        start_date: c.start_date,
        end_date: c.end_date,
        photo_count: c.photo_count,
        cover_thumb_url: cover ? signPhotoUrl(cover.thumb_key || cover.b2_key) : null,
      };
    });

    res.json({ points });
  } catch (err) {
    console.error('mapPointsHandler failed:', err);
    res.status(500).json({ error: 'internal error' });
  }
}
