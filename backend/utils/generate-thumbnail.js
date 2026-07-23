
// scripts/generate-thumbnails.js
//
// Runs on Render as a scheduled Cron Job (not on Termux — sharp needs a normal
// Linux environment, which Render's containers provide). Finds any photo rows
// missing a thumbnail, generates one via sharp, uploads it to B2, and marks
// the row as done. Safe to run repeatedly — only processes rows that still
// need it.

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

// S3 SDK returns the object body as a readable stream, not a Buffer directly
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

const PAGE_SIZE = 1000; // Supabase's default max rows per request

// Fetches ALL rows missing a thumbnail, paging through in batches of
// PAGE_SIZE until a page comes back with fewer rows than requested
// (meaning there's nothing left to fetch).
async function fetchAllPendingRows() {
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

    if (data.length < PAGE_SIZE) break; // last page — nothing more to fetch
    from += PAGE_SIZE;
  }

  return allRows;
}

async function run() {
  let rows;
  try {
    rows = await fetchAllPendingRows();
  } catch (err) {
    console.error('Failed to fetch pending rows:', err.message);
    process.exit(1);
  }

  console.log(`Found ${rows.length} photo(s) needing a thumbnail.`);

  let done = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const original = await downloadFromB2(row.b2_key);
      const thumbKey = `thumbnails/${row.b2_key}`;
      const thumbBuffer = await sharp(original)
        .resize(THUMBNAIL_WIDTH, THUMBNAIL_WIDTH, { fit: 'cover' })
        .jpeg({ quality: 75 })
        .toBuffer();

      await uploadToB2(thumbKey, thumbBuffer);

      const { error: updateError } = await supabase
        .from('photos')
        .update({ thumb_key: thumbKey })
        .eq('id', row.id);

      if (updateError) throw new Error(updateError.message);

      done += 1;
    } catch (err) {
      console.error(`Failed on ${row.b2_key}:`, err.message);
      failed += 1;
    }
  }

  console.log(`Done: ${done} thumbnails generated, ${failed} failed.`);
}

run().catch((err) => {
  console.error('generate-thumbnails failed:', err);
  process.exit(1);
});

