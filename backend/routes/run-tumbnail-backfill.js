
// routes/thumbnail-webhook.js
//
// Called by a Supabase Database Webhook whenever a new row is inserted into
// `photos`. Uses the SAME shared generateThumbnailFor() as the CLI backfill
// script and the GitHub-Actions-triggered route — so video detection, ffmpeg
// frame extraction, and the media_type self-correction all apply here too,
// automatically, with no duplicated logic to keep in sync.

import { generateThumbnailFor } from '../scripts/generate-thumbnails-lib.js';

export async function thumbnailWebhookHandler(req, res) {
  const secret = req.headers['x-webhook-secret'];
  if (secret !== process.env.SUPABASE_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'invalid webhook secret' });
  }

  const { record } = req.body; // Supabase's webhook payload shape: { type, table, record, ... }

  if (!record || record.thumb_key) {
    // already has a thumbnail (e.g. a manual re-trigger) — nothing to do.
    // NOTE: no media_type check here anymore — generateThumbnailFor figures
    // out image vs video from the actual filename, not the (possibly wrong)
    // stored column, so this route no longer needs to pre-filter on it.
    return res.status(200).json({ skipped: true });
  }

  // respond quickly — Supabase's webhook caller expects a fast response and
  // doesn't need to wait for the image/video processing to finish
  res.status(200).json({ accepted: true });

  try {
    await generateThumbnailFor(record);
    console.log(`Thumbnail generated for ${record.b2_key}`);
  } catch (err) {
    console.error(`Thumbnail generation failed for ${record.b2_key}:`, err.message);
    // the periodic backfill (GitHub Actions → /api/admin/run-thumbnail-backfill)
    // will catch this on its next run, since thumb_key will still be null
  }
}
