
// routes/run-thumbnail-backfill.js
import { fetchAllPendingRows, generateThumbnailFor } from '../scripts/generate-thumbnails-lib.js';

export async function runThumbnailBackfillHandler(req, res) {
  const secret = req.headers['x-backfill-secret'];
  if (secret !== process.env.BACKFILL_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  res.status(200).json({ started: true }); // respond fast, same pattern as the webhook

  try {
    const rows = await fetchAllPendingRows();
    console.log(`Backfill: found ${rows.length} photo(s) needing a thumbnail.`);
    for (const row of rows) {
      try {
        await generateThumbnailFor(row);
      } catch (err) {
        console.error(`Backfill failed on ${row.b2_key}:`, err.message);
      }
    }
  } catch (err) {
    console.error('Backfill run failed:', err);
  }
}
