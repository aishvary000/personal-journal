
// routes/thumbnail-webhook.js
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

// helper: S3 SDK returns a readable stream, not a Buffer directly — this
// collects it into one
async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function generateThumbnailFor(row) {
  const getResponse = await s3.send(
    new GetObjectCommand({ Bucket: process.env.B2_BUCKET, Key: row.b2_key })
  );
  const original = await streamToBuffer(getResponse.Body);

  const thumbKey = `thumbnails/${row.b2_key}`;
  const thumbBuffer = await sharp(original)
    .resize(THUMBNAIL_WIDTH, THUMBNAIL_WIDTH, { fit: 'cover' })
    .jpeg({ quality: 75 })
    .toBuffer();

  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.B2_BUCKET,
      Key: thumbKey,
      Body: thumbBuffer,
      ContentType: 'image/jpeg',
    })
  );

  await supabase.from('photos').update({ thumb_key: thumbKey }).eq('id', row.id);
}

export async function thumbnailWebhookHandler(req, res) {
  const secret = req.headers['x-webhook-secret'];
  if (secret !== process.env.SUPABASE_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'invalid webhook secret' });
  }

  const { record } = req.body;

  if (!record || record.media_type !== 'image' || record.thumb_key) {
    return res.status(200).json({ skipped: true });
  }

  res.status(200).json({ accepted: true });

  try {
    await generateThumbnailFor(record);
    console.log(`Thumbnail generated for ${record.b2_key}`);
  } catch (err) {
    console.error(`Thumbnail generation failed for ${record.b2_key}:`, err.message);
  }
}