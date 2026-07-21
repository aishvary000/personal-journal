import {signPhotoUrl} from '../utils/sing-photo-url.js';
import { createClient } from '@supabase/supabase-js';
function isValidDateString(str) {
  // expects YYYY-MM-DD; rejects garbage before it ever reaches Postgres
  return /^\d{4}-\d{2}-\d{2}$/.test(str) && !isNaN(new Date(str).getTime());
}

// GET /api/photos?start=YYYY-MM-DD&end=YYYY-MM-DD
// Defaults to today (start = end = today) if no params are given, so this route
// also covers the plain "On This Day" case with zero query params.
export async function photosInRangeHandler(req, res) {
  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    )
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD, local server date
    const start = req.query.start || today;
    const end = req.query.end || start;

    if (!isValidDateString(start) || !isValidDateString(end)) {
      return res.status(400).json({ error: 'start/end must be valid dates in YYYY-MM-DD format' });
    }

    if (new Date(start) > new Date(end)) {
      return res.status(400).json({ error: 'start date must be before or equal to end date' });
    }
    // calls the photos_in_range(start_date, end_date) Postgres function directly —
    // filtering happens in the database, not in this handler
    try{
    const { data, error } = await supabase.rpc('photos_in_range', {
      start_date: start,
      end_date: end,
    });
    if (error) {
      console.error('RPC photos_in_range failed:', error.message);
      return res.status(500).json({ error: 'failed to fetch photos' });
    }
     const now = new Date();
    const results = data.map((row) => ({
      id: row.id,
      taken_at: row.taken_at,
      years_ago: now.getFullYear() - new Date(row.taken_at).getFullYear(),
      url: signPhotoUrl(row.b2_key),
    }));

    res.json({ start, end, count: results.length, photos: results });
  }
  catch(err){
    console.log("err is : ",err);
  }

    

   
  } catch (err) {
    console.error('photos-in-range handler failed:', err);
    res.status(500).json({ error: 'internal error' });
  }
}