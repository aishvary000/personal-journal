// scripts/generate-thumbnails-lib.js
//
// Shared logic used by both:
//   - scripts/generate-thumbnails.js (manual/CLI run, e.g. the initial backfill)
//   - routes/run-thumbnail-backfill.js (triggered via the GitHub Actions cron)
//
// Keeping this in one place means both callers stay in sync automatically —
// no risk of the CLI script and the route drifting apart over time.

import { createClient } from '@supabase/supabase-js';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const s3 = new S3Client({
  endpoint: `https://s3.${process.env.B2_REGION}.backblazeb2.com`,
  region: process.env.B2_REGION,
  credentials: {
    accessKeyId: process.env.B2_KEY_ID,
    secretAccessKey: process.env.B2_APP_KEY,
  },
});

const THUMBNAIL_WIDTH = 400;
const PAGE_SIZE = 1000; // Supabase's default max rows per request

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function downloadFromB2(key) {
  const response = await s3.send(
    new GetObjectCommand({ Bucket: process.env.B2_BUCKET, Key: key })
  );
  return streamToBuffer(response.Body);
}

async function uploadToB2(key, buffer) {
  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.B2_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: 'image/jpeg',
    })
  );
}

// Fetches ALL rows missing a thumbnail, paging through in batches of
// PAGE_SIZE until a page comes back with fewer rows than requested.
export async function fetchAllPendingRows() {
  let allRows = [];
  let from = 0;

  while (true) {
    const to = from + PAGE_SIZE - 1;

    const { data, error } = await supabase
      .from('photos')
      .select('id, b2_key')
      .eq('media_type', 'image')
      .is('thumb_key', null)
      .range(from, to);

    if (error) throw new Error(error.message);

    allRows = allRows.concat(data);

    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return allRows;
}

// Generates a thumbnail for ONE row, uploads it to B2, and updates the row's
// thumb_key. Used both by the CLI backfill script (looping over many rows)
// and the webhook handler (called for a single freshly-inserted row).
export async function generateThumbnailFor(row) {
  const original = await downloadFromB2(row.b2_key);
  const thumbKey = `thumbnails/${row.b2_key}`;

  const thumbBuffer = await sharp(original)
    .resize(THUMBNAIL_WIDTH, THUMBNAIL_WIDTH, { fit: 'cover' })
    .jpeg({ quality: 75 })
    .toBuffer();

  await uploadToB2(thumbKey, thumbBuffer);

  const { error } = await supabase
    .from('photos')
    .update({ thumb_key: thumbKey })
    .eq('id', row.id);

  if (error) throw new Error(error.message);
}
