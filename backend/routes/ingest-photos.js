
// routes/ingest-photos.js
//
// Called by backup.sh right after rclone uploads new files — Termux no
// longer runs any metadata-extraction code itself (exiftool-vendored is a
// native binary, same category of risk as sharp/ffmpeg, so this stays on
// Render exactly like thumbnail generation does).

import { createClient } from '@supabase/supabase-js';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { extractMetadata } from '../scripts/extract-metadata.js';
import { generateThumbnailFromBuffer } from '../scripts/generate-thumbnails-lib.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const s3 = new S3Client({
  endpoint: `https://s3.${process.env.B2_REGION}.backblazeb2.com`,
  region: process.env.B2_REGION,
  credentials: {
    accessKeyId: process.env.B2_KEY_ID,
    secretAccessKey: process.env.B2_APP_KEY,
  },
});

const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];
function isVideo(key) {
  return VIDEO_EXTENSIONS.some((ext) => key.toLowerCase().endsWith(ext));
}
function detectSource(key) {
  return key.startsWith('osmo/') ? 'osmo' : 'phone';
}
function extractDateFromFilename(key) {
  const match = key.match(/(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}+05:30`).toISOString();
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

// POST /api/admin/ingest-photos  (protected by a shared secret, called from backup.sh)
// body: { keys: ["camera/IMG_....jpg", "osmo/DJI_0042.MP4", ...] }
export async function ingestPhotosHandler(req, res) {
  const secret = req.headers['x-ingest-secret'];
  if (secret !== process.env.INGEST_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const { keys } = req.body;
  if (!Array.isArray(keys) || keys.length === 0) {
    return res.status(400).json({ error: 'keys must be a non-empty array' });
  }

  // respond immediately — Termux doesn't need to wait for this to finish
  res.status(200).json({ accepted: true, count: keys.length });

  let synced = 0;
  let skipped = 0;

  for (const b2Key of keys) {
    try {
      const response = await s3.send(
        new GetObjectCommand({ Bucket: process.env.B2_BUCKET, Key: b2Key })
      );
      const buffer = await streamToBuffer(response.Body);
      const filename = b2Key.split('/').pop();

      const { takenAt: metaDate, latitude, longitude } = await extractMetadata(buffer, filename);
      const takenAt = metaDate || extractDateFromFilename(b2Key);

      if (!takenAt) {
        console.warn(`Skipping ${b2Key} — no date from metadata or filename`);
        skipped += 1;
        continue;
      }

      // Generate the thumbnail right here, reusing the buffer we already
      // downloaded for metadata extraction — avoids the webhook re-downloading
      // the same original from B2 a second time. If this fails for any reason,
      // thumb_key just stays null and the webhook/daily backfill catches it
      // as a fallback, same safety net as before.
      let thumbKey = null;
      let mediaType = isVideo(b2Key) ? 'video' : 'image';
      try {
        const result = await generateThumbnailFromBuffer(b2Key, buffer);
        thumbKey = result.thumbKey;
        mediaType = result.mediaType; // self-corrects if extension-based detection was wrong
      } catch (thumbErr) {
        console.warn(`Thumbnail generation failed for ${b2Key} during ingest: ${thumbErr.message}`);
        // leave thumb_key null — webhook fires on insert below, but since it
        // sees a null thumb_key it will actually try again (not skip),
        // giving this a second chance without any extra code needed here
      }

      const { error } = await supabase.from('photos').upsert(
        {
          b2_key: b2Key,
          taken_at: takenAt,
          latitude,
          longitude,
          source: detectSource(b2Key),
          media_type: mediaType,
          thumb_key: thumbKey,
        },
        { onConflict: 'b2_key' }
      );

      if (error) {
        console.error(`Failed to upsert ${b2Key}:`, error.message);
        skipped += 1;
        continue;
      }

      synced += 1;
    } catch (err) {
      console.error(`Failed processing ${b2Key}:`, err.message);
      skipped += 1;
    }
  }

  console.log(`Ingest done: ${synced} synced, ${skipped} skipped, out of ${keys.length}.`);
}
