
// routes/delete-share.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// DELETE /api/shares/:shareId  (behind requireAuth)
// Permanently removes a collection — the link immediately stops working
// (unlockShareHandler's lookup will just find no matching row).
export async function deleteShareHandler(req, res) {
  try {
    const { shareId } = req.params;

    const { error } = await supabase.from('shares').delete().eq('id', shareId);

    if (error) {
      console.error('Failed to delete share:', error.message);
      return res.status(500).json({ error: 'failed to delete collection' });
    }

    res.json({ deleted: true });
  } catch (err) {
    console.error('deleteShareHandler failed:', err);
    res.status(500).json({ error: 'internal error' });
  }
}
