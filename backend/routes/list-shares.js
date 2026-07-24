// routes/list-shares.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// GET /api/shares?limit=20&offset=0  (behind requireAuth)
export async function listSharesHandler(req, res) {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 100); // cap at 100 per request
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const { data, error, count } = await supabase
      .from('shares')
      .select('id, collection_name, share_url, expires_at, created_at, photo_ids', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('Failed to list shares:', error.message);
      return res.status(500).json({ error: 'failed to list shares' });
    }

    const now = new Date();
    const results = data.map((row) => ({
      id: row.id,
      collection_name: row.collection_name,
      share_url: row.share_url,
      created_at: row.created_at,
      expires_at: row.expires_at,
      is_expired: row.expires_at ? new Date(row.expires_at) < now : false,
      photo_count: row.photo_ids?.length || 0,
    }));

    res.json({
      shares: results,
      total: count,
      has_more: offset + results.length < count,
    });
  } catch (err) {
    console.error('listSharesHandler failed:', err);
    res.status(500).json({ error: 'internal error' });
  }
}