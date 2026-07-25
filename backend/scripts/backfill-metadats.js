// scripts/backfill-metadata.js
//
// One-time backfill for rows synced BEFORE camera make/model, dimensions,
// duration, orientation, and phash were captured. Unlike ingest-photos.js,
// this does NOT regenerate thumbnails — they already exist and haven't
// changed. It downloads the ORIGINAL (for metadata) and the EXISTING
// thumbnail (for phash) separately, avoiding a wasteful re-upload.
//
// Run with: node --env-file=.env scripts/backfill-metadata.js

import { createClient } from '@supabase/supabase-js';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { extractMetadata, closeExifTool } from './extract-metadata.js';
import phash from 'sharp-phash';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const s3 = new S3Client({
  endpoint: `https://s3.${process.env.B2_REGION}.backblazeb2.com`,
  region: process.env.B2_REGION,
  credentials: {
    accessKeyId: process.env.B2_KEY_ID,
    secretAccessKey: process.env.B2_APP_KEY,
  },
});

const PAGE_SIZE = 1000;

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function downloadFromB2(key) {
  const response = await s3.send(new GetObjectCommand({ Bucket: process.env.B2_BUCKET, Key: key }));
  return streamToBuffer(response.Body);
}

// Rows missing the new fields — using camera_make as the "have I processed
// this row yet" marker, since it's null for anything synced before this change.
async function fetchRowsNeedingBackfill() {
  let allRows = [];
  let from = 0;

  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from('photos')
      .select('id, b2_key, thumb_key')
      .is('phash', null)
      .range(from, to);

    if (error) throw new Error(error.message);
    allRows = allRows.concat(data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return allRows;
}

const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];
function isVideo(key) {
  return VIDEO_EXTENSIONS.some((ext) => key.toLowerCase().endsWith(ext));
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

// Photos: the already-downloaded original buffer works directly — phash
// resizes internally to a tiny fixed size as its first step regardless of
// input size, so there's no benefit to using the smaller thumbnail instead,
// and using the original avoids a second B2 download entirely.
//
// Videos: the original is raw container bytes, not a decodable image — sharp
// can't hash that directly. The extracted-frame thumbnail is the only usable
// image, so it still needs a (small, cheap) separate download for those.
async function computePhash(row, originalBuffer) {
  try {
    if (isVideo(row.b2_key)) {
      if (!row.thumb_key) return null;
      const thumbBuffer = await downloadFromB2(row.thumb_key);
      return await withTimeout(phash(thumbBuffer), 15000, 'phash computation');
    }
    return await withTimeout(phash(originalBuffer), 15000, 'phash computation');
  } catch (err) {
    console.warn(`phash failed for ${row.b2_key}: ${err.message}`);
    return null;
  }
}

async function run() {
  const rows = await fetchRowsNeedingBackfill();
  console.log(`Found ${rows.length} row(s) needing metadata backfill.`);

  let done = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const originalBuffer = await downloadFromB2(row.b2_key);
      const filename = row.b2_key.split('/').pop();

      const meta = await extractMetadata(originalBuffer, filename);
      const phashValue = await computePhash(row, originalBuffer);

      const { error } = await supabase
        .from('photos')
        .update({
          camera_make: meta.cameraMake,
          camera_model: meta.cameraModel,
          width: meta.width,
          height: meta.height,
          duration_seconds: meta.durationSeconds,
          orientation: meta.orientation,
          checksum: meta.checksum,
          file_size: meta.fileSize,
          iso: meta.iso,
          aperture: meta.aperture,
          shutter_speed: meta.shutterSpeed,
          focal_length: meta.focalLength,
          gps_altitude: meta.gpsAltitude,
          ...(meta.takenAt ? { taken_at: meta.takenAt } : {}),
          ...(meta.latitude != null ? { latitude: meta.latitude } : {}),
          ...(meta.longitude != null ? { longitude: meta.longitude } : {}),
          ...(phashValue ? { phash: phashValue } : {}),
        })
        .eq('id', row.id);

      if (error) throw new Error(error.message);
      console.log(`✓ ${row.b2_key}`);
      done += 1;
    } catch (err) {
      console.error(`✗ ${row.b2_key}: ${err.message}`);
      failed += 1;
    }
  }

  console.log(`Done: ${done} updated, ${failed} failed, out of ${rows.length}.`);
}

run()
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeExifTool();
  });

