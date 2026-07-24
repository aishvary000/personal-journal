

// scripts/generate-thumbnails-lib.js
import { createClient } from '@supabase/supabase-js';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import ffprobePath from '@ffprobe-installer/ffprobe';
import fs from 'fs';
import os from 'os';
import path from 'path';

ffmpeg.setFfmpegPath(ffmpegPath.path);
ffmpeg.setFfprobePath(ffprobePath.path); // needed for percentage-based ('1%') timestamps —
                                          // fluent-ffmpeg uses ffprobe to determine each
                                          // video's duration before calculating the seek point

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
const VIDEO_FRAME_TIMESTAMP = '1%'; // percentage-based — scales with each video's
                                     // actual duration, so it works even for clips
                                     // shorter than 1 second (a fixed '00:00:01'
                                     // fails silently on very short videos)

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
async function extractFrameAt(videoPath, tmpDir, tmpFramePath, timestamp) {
  await new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .on('end', resolve)
      .on('error', reject)
      .screenshots({
        timestamps: [timestamp],
        filename: path.basename(tmpFramePath),
        folder: tmpDir,
      });
  });

  // fluent-ffmpeg's 'end' event can fire even when no file was actually
  // written (e.g. seeking past a very short video's duration) — verify it's
  // really there before trusting it.
  return fs.existsSync(tmpFramePath);
}

async function extractVideoFrame(videoBuffer) {
  const tmpDir = os.tmpdir();
  const tmpVideoPath = path.join(tmpDir, `vid-${Date.now()}.mp4`);
  const tmpFramePath = path.join(tmpDir, `frame-${Date.now()}.jpg`);

  fs.writeFileSync(tmpVideoPath, videoBuffer);

  let ok = await extractFrameAt(tmpVideoPath, tmpDir, tmpFramePath, VIDEO_FRAME_TIMESTAMP);

  if (!ok) {
    // fallback: try the very first frame, in case the percentage-based seek
    // still landed past the end of an unusually short/malformed clip
    console.warn('First frame extraction attempt produced no file, retrying at 0%');
    ok = await extractFrameAt(tmpVideoPath, tmpDir, tmpFramePath, '0%');
  }

  if (!ok) {
    fs.unlinkSync(tmpVideoPath);
    throw new Error('ffmpeg did not produce a frame at any attempted timestamp');
  }

  const frameBuffer = fs.readFileSync(tmpFramePath);

  fs.unlinkSync(tmpVideoPath);
  fs.unlinkSync(tmpFramePath);

  return frameBuffer;
}

// Some phones save photos as HEIC/HEIF even with a .jpg extension — sharp's
// prebuilt binary can't decode that format. ffmpeg has much broader format
// support, so it's used as a fallback: convert whatever format this actually
// is into a plain JPEG first, then hand that to sharp for resizing.
async function convertUnknownFormatToJpeg(buffer) {
  const tmpDir = os.tmpdir();
  const tmpInputPath = path.join(tmpDir, `unknown-${Date.now()}`);
  const tmpOutputPath = path.join(tmpDir, `converted-${Date.now()}.jpg`);

  fs.writeFileSync(tmpInputPath, buffer);

  await new Promise((resolve, reject) => {
    ffmpeg(tmpInputPath)
      .outputOptions(['-frames:v', '1']) // just one frame/image, not a video
      .save(tmpOutputPath)
      .on('end', resolve)
      .on('error', reject);
  });

  const converted = fs.readFileSync(tmpOutputPath);

  fs.unlinkSync(tmpInputPath);
  fs.unlinkSync(tmpOutputPath);

  return converted;
}

// Core logic — accepts a buffer you already have, so callers that already
// downloaded the original (like ingestPhotosHandler) don't need to fetch it
// from B2 a second time. Returns the thumb_key and corrected media_type,
// but does NOT touch the database itself — callers decide how to persist it.
export async function generateThumbnailFromBuffer(b2Key, original) {
  const videoDetected = isVideo(b2Key);

  let sourceForResize;
  if (videoDetected) {
    sourceForResize = await extractVideoFrame(original);
  } else {
    sourceForResize = original;
  }

  let thumbBuffer;
  try {
    thumbBuffer = await sharp(sourceForResize)
      .resize(THUMBNAIL_WIDTH, THUMBNAIL_WIDTH, { fit: 'cover' })
      .jpeg({ quality: 75 })
      .toBuffer();
  } catch (sharpErr) {
    if (videoDetected) throw sharpErr;
    console.warn(`sharp failed on ${b2Key} (${sharpErr.message}), falling back to ffmpeg conversion`);
    const converted = await convertUnknownFormatToJpeg(sourceForResize);
    thumbBuffer = await sharp(converted)
      .resize(THUMBNAIL_WIDTH, THUMBNAIL_WIDTH, { fit: 'cover' })
      .jpeg({ quality: 75 })
      .toBuffer();
  }

  const thumbKey = `thumbnails/${b2Key.replace(/\.[^/.]+$/, '')}.jpg`;
  await uploadToB2(thumbKey, thumbBuffer);

  return { thumbKey, mediaType: videoDetected ? 'video' : 'image' };
}

// Row-based wrapper — used by the CLI backfill and the webhook, which only
// have a row (not an already-downloaded buffer) to start from. Downloads the
// original itself, then delegates to the shared core above, and persists
// the result to the database.
export async function generateThumbnailFor(row) {
  const original = await downloadFromB2(row.b2_key);
  const { thumbKey, mediaType } = await generateThumbnailFromBuffer(row.b2_key, original);

  const { error } = await supabase
    .from('photos')
    .update({ thumb_key: thumbKey, media_type: mediaType })
    .eq('id', row.id);

  if (error) throw new Error(error.message);
}