
// routes/add-to-share.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// POST /api/shares/:shareId/add-photos  (behind requireAuth)
// body: { photo_ids: [4, 5, 6] }
//
// Merges the given photo_ids into an existing collection's photo_ids array,
// de-duplicating so adding the same photo twice is harmless. The link and
// passcode are untouched — this only changes which photos the existing
// link/passcode combination reveals.
export async function addToShareHandler(req, res) {
  try {
    const { shareId } = req.params;
    const { photo_ids } = req.body;

    if (!Array.isArray(photo_ids) || photo_ids.length === 0) {
      return res.status(400).json({ error: 'photo_ids must be a non-empty array' });
    }

    const { data: share, error: fetchError } = await supabase
      .from('shares')
      .select('id, photo_ids, collection_name, share_url')
      .eq('id', shareId)
      .single();

    if (fetchError || !share) {
      return res.status(404).json({ error: 'collection not found' });
    }

    const merged = Array.from(new Set([...share.photo_ids, ...photo_ids]));

    const { error: updateError } = await supabase
      .from('shares')
      .update({ photo_ids: merged })
      .eq('id', shareId);

    if (updateError) {
      console.error('Failed to add photos to share:', updateError.message);
      return res.status(500).json({ error: 'failed to update collection' });
    }

    res.json({
      collection_name: share.collection_name,
      url: share.share_url,
      photo_count: merged.length,
    });
  } catch (err) {
    console.error('addToShareHandler failed:', err);
    res.status(500).json({ error: 'internal error' });
  }
}

