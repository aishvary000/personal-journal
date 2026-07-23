// scripts/generate-thumbnails-lib.js
import { createClient } from '@supabase/supabase-js';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import fs from 'fs';
import os from 'os';
import path from 'path';

ffmpeg.setFfmpegPath(ffmpegPath.path);

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
const PAGE_SIZE = 1000;
const VIDEO_FRAME_TIMESTAMP = '00:00:05'; // grab the frame at 1 second in

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function downloadFromB2(key) {
  const response = await s3.send(new GetObjectCommand({ Bucket: process.env.B2_BUCKET, Key: key }));
  return streamToBuffer(response.Body);
}

async function uploadToB2(key, buffer, contentType = 'image/jpeg') {
  await s3.send(
    new PutObjectCommand({ Bucket: process.env.B2_BUCKET, Key: key, Body: buffer, ContentType: contentType })
  );
}

export async function fetchAllPendingRows() {
  let allRows = [];
  let from = 0;

  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from('photos')
      .select('id, b2_key, media_type')
      .is('thumb_key', null)
      .range(from, to);

    if (error) throw new Error(error.message);
    allRows = allRows.concat(data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return allRows;
}

const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];

// Detect from the actual filename, not the (possibly wrong/stale) media_type
// column — this is what caused sharp() to be handed raw video bytes for rows
// that were inserted before video detection existed in the sync script.
function isVideo(key) {
  return VIDEO_EXTENSIONS.some((ext) => key.toLowerCase().endsWith(ext));
}
// Downloads a video to a temp file (ffmpeg needs a real file path, not a
// buffer), extracts one frame as a JPEG, and returns that frame as a buffer.
// Temp files are cleaned up afterward regardless of success/failure.
async function extractVideoFrame(videoBuffer) {
  const tmpDir = os.tmpdir();
  const tmpVideoPath = path.join(tmpDir, `vid-${Date.now()}.mp4`);
  const tmpFramePath = path.join(tmpDir, `frame-${Date.now()}.jpg`);

  fs.writeFileSync(tmpVideoPath, videoBuffer);

  await new Promise((resolve, reject) => {
    ffmpeg(tmpVideoPath)
      .on('end', resolve)
      .on('error', reject)
      .screenshots({
        timestamps: [VIDEO_FRAME_TIMESTAMP],
        filename: path.basename(tmpFramePath),
        folder: tmpDir,
      });
  });

  const frameBuffer = fs.readFileSync(tmpFramePath);

  fs.unlinkSync(tmpVideoPath);
  fs.unlinkSync(tmpFramePath);

  return frameBuffer;
}

export async function generateThumbnailFor(row) {
  const original = await downloadFromB2(row.b2_key);
  const videoDetected = isVideo(row.b2_key);

  let sourceForResize;
  if (videoDetected) {
    sourceForResize = await extractVideoFrame(original);
  } else {
    sourceForResize = original;
  }

  const thumbBuffer = await sharp(sourceForResize)
    .resize(THUMBNAIL_WIDTH, THUMBNAIL_WIDTH, { fit: 'cover' })
    .jpeg({ quality: 75 })
    .toBuffer();

  // thumbnails are always stored as .jpg, regardless of the original's extension
  const thumbKey = `thumbnails/${row.b2_key.replace(/\.[^/.]+$/, '')}.jpg`;
  await uploadToB2(thumbKey, thumbBuffer);

  // also correct media_type here, in case this row's stored value was wrong
  // (e.g. inserted before video detection existed in the sync script)
  const { error } = await supabase
    .from('photos')
    .update({ thumb_key: thumbKey, media_type: videoDetected ? 'video' : 'image' })
    .eq('id', row.id);

  if (error) throw new Error(error.message);
}
