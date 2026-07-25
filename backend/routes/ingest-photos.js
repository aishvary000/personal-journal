
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
import phash from 'sharp-phash';

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

// Fire-and-forget: computes phash from a buffer already in memory (no extra
// download needed) and writes it in a SEPARATE update once done. Deliberately
// not awaited by the caller — a slow or hung phash computation can never
// block the main upsert or delay processing of the next photo in the batch.
function schedulePhashUpdate(supabase, b2Key, thumbBuffer) {
  console.log(`[${b2Key}] scheduling background phash computation`);
  withTimeout(phash(thumbBuffer), 10000, 'phash computation')
    .then(async (phashValue) => {
      console.log(`[${b2Key}] phash computed successfully:`, phashValue);
      const { error } = await supabase.from('photos').update({ phash: phashValue }).eq('b2_key', b2Key);
      if (error) console.error(`[${b2Key}] failed to save phash:`, error.message);
      else console.log(`[${b2Key}] phash saved to DB`);
    })
    .catch((err) => {
      console.warn(`[${b2Key}] phash computation failed: ${err.message}`);
    });
}

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

  console.log(`Starting ingest for ${keys.length} key(s):`, keys);

  let synced = 0;
  let skipped = 0;

  for (const b2Key of keys) {
    console.log(`[${b2Key}] --- starting ---`);
    try {
      console.log(`[${b2Key}] downloading from B2...`);
      const response = await s3.send(
        new GetObjectCommand({ Bucket: process.env.B2_BUCKET, Key: b2Key })
      );
      const buffer = await streamToBuffer(response.Body);
      console.log(`[${b2Key}] downloaded, size=${buffer.length} bytes`);

      const filename = b2Key.split('/').pop();

      console.log(`[${b2Key}] extracting metadata...`);
      const {
        takenAt: metaDate,
        latitude,
        longitude,
        cameraMake,
        cameraModel,
        width,
        height,
        durationSeconds,
        orientation,
        checksum,
        fileSize,
        iso,
        aperture,
        shutterSpeed,
        focalLength,
        gpsAltitude,
      } = await extractMetadata(buffer, filename);
      console.log(`[${b2Key}] metadata extracted:`, {
        metaDate, latitude, longitude, cameraMake, cameraModel, width, height, checksum: checksum?.slice(0, 8),
      });

      const takenAt = metaDate || extractDateFromFilename(b2Key);
      console.log(`[${b2Key}] final takenAt:`, takenAt);

      if (!takenAt) {
        console.warn(`[${b2Key}] SKIPPING — no date from metadata or filename`);
        skipped += 1;
        continue;
      }

      // Generate the thumbnail right here, reusing the buffer we already
      // downloaded for metadata extraction — avoids the webhook re-downloading
      // the same original from B2 a second time. If this fails for any reason,
      // thumb_key just stays null and the webhook/daily backfill catches it
      // as a fallback, same safety net as before.
      let thumbKey = null;
      let thumbBuffer = null;
      let mediaType = isVideo(b2Key) ? 'video' : 'image';
      console.log(`[${b2Key}] generating thumbnail (mediaType guess: ${mediaType})...`);
      try {
        const result = await generateThumbnailFromBuffer(b2Key, buffer);
        thumbKey = result.thumbKey;
        thumbBuffer = result.thumbBuffer;
        mediaType = result.mediaType; // self-corrects if extension-based detection was wrong
        console.log(`[${b2Key}] thumbnail generated, thumbKey=${thumbKey}, mediaType=${mediaType}`);
      } catch (thumbErr) {
        console.warn(`[${b2Key}] thumbnail generation FAILED: ${thumbErr.message}`);
      }

      console.log(`[${b2Key}] upserting into photos table...`);
      const { error } = await supabase.from('photos').upsert(
        {
          b2_key: b2Key,
          taken_at: takenAt,
          latitude,
          longitude,
          camera_make: cameraMake,
          camera_model: cameraModel,
          width,
          height,
          duration_seconds: durationSeconds,
          orientation,
          checksum,
          file_size: fileSize,
          iso,
          aperture,
          shutter_speed: shutterSpeed,
          focal_length: focalLength,
          gps_altitude: gpsAltitude,
          media_type: mediaType,
          thumb_key: thumbKey,
        },
        { onConflict: 'b2_key' }
      );

      if (error) {
        console.error(`[${b2Key}] UPSERT FAILED:`, error.message);
        skipped += 1;
        continue;
      }
      console.log(`[${b2Key}] upsert succeeded`);

      // Fire-and-forget — uses the thumbnail buffer already in memory (no
      // extra download from B2), and can never slow down or block this loop
      // since it isn't awaited. Succeeds or fails independently, later.
      if (thumbBuffer) {
        schedulePhashUpdate(supabase, b2Key, thumbBuffer);
      } else {
        console.log(`[${b2Key}] no thumbBuffer available, skipping phash scheduling`);
      }

      synced += 1;
      console.log(`[${b2Key}] --- done ---`);
    } catch (err) {
      console.error(`[${b2Key}] FAILED PROCESSING:`, err.message, err.stack);
      skipped += 1;
    }
  }

  console.log(`Ingest done: ${synced} synced, ${skipped} skipped, out of ${keys.length}.`);
}