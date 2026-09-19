
// transcode-scheduled.js
//
// GitHub Actions version of the transcoding backfill. Same design pattern
// as cache-warm-scheduled.js: database-tracked (web_video_key IS NULL means
// "still needs work"), stops once real elapsed time approaches the run's
// budget, and picks up wherever it left off on the next scheduled run.
//
// Runs slower per-video than on Apple Silicon (no hardware encoder on
// GitHub's runners), but runs unattended on its own schedule.

import { createClient } from '@supabase/supabase-js';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import ffprobePath from '@ffprobe-installer/ffprobe';
import fs from 'fs';
import os from 'os';
import path from 'path';

ffmpeg.setFfmpegPath(ffmpegPath.path);
ffmpeg.setFfprobePath(ffprobePath.path);

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const s3 = new S3Client({
  endpoint: `https://s3.${process.env.B2_REGION}.backblazeb2.com`,
  region: process.env.B2_REGION,
  credentials: { accessKeyId: process.env.B2_KEY_ID, secretAccessKey: process.env.B2_APP_KEY },
});

const MAX_RUN_BUDGET_SECONDS = Number(process.env.MAX_RUN_BUDGET_SECONDS) || 18000;
const TARGET_BITRATE = '8M';
const MAX_BITRATE = '10M';
const BUFSIZE = '20M';
const BITRATE_THRESHOLD_MBPS = 15;

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms)),
  ]);
}

// Budgets for BOTH download time and encode time, since transcoding is
// CPU-bound and much less predictable than a pure network fetch — content
// complexity, runner CPU contention, etc. all affect actual encode speed.
function computeVideoTimeoutMs(fileSizeBytes) {
  if (!fileSizeBytes) return 20 * 60 * 1000; // unknown size — 20 min default
  const conservativeMbps = 10;
  const downloadSeconds = (fileSizeBytes * 8) / (conservativeMbps * 1_000_000);
  // Software x264 encoding on a generic 2-vCPU runner: assume up to roughly
  // 3x the naive download-time estimate to cover encode + upload, as a
  // conservative ceiling — real runs should finish well inside this.
  const conservativeEncodeSeconds = downloadSeconds * 3;
  return Math.max((downloadSeconds + conservativeEncodeSeconds) * 1000 + 3 * 60 * 1000, 10 * 60 * 1000);
}

function downloadToFile(key, destPath) {
  return new Promise(async (resolve, reject) => {
    try {
      const response = await s3.send(new GetObjectCommand({ Bucket: process.env.B2_BUCKET, Key: key }));
      const writeStream = fs.createWriteStream(destPath);
      response.Body.pipe(writeStream);
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    } catch (err) {
      reject(err);
    }
  });
}

function probe(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err);
      const videoStream = metadata.streams.find((s) => s.codec_type === 'video');
      resolve({
        codec: videoStream?.codec_name || null,
        bitrateMbps: videoStream?.bit_rate ? Number(videoStream.bit_rate) / 1_000_000 : null,
        durationSeconds: metadata.format?.duration || null,
      });
    });
  });
}

function transcode(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .videoCodec('libx264')
      .outputOptions([`-b:v ${TARGET_BITRATE}`, `-maxrate ${MAX_BITRATE}`, `-bufsize ${BUFSIZE}`, '-preset fast', '-movflags +faststart'])
      .audioCodec('aac')
      .on('end', resolve)
      .on('error', reject)
      .save(outputPath);
  });
}

async function uploadFromFile(key, filePath, contentType) {
  const upload = new Upload({
    client: s3,
    params: { Bucket: process.env.B2_BUCKET, Key: key, Body: fs.createReadStream(filePath), ContentType: contentType },
    queueSize: 4,
    partSize: 10 * 1024 * 1024,
  });
  await upload.done();
}

async function processOne(video) {
  const tmpDir = os.tmpdir();
  const originalPath = path.join(tmpDir, `orig-${video.id}.mp4`);
  const webPath = path.join(tmpDir, `web-${video.id}.mp4`);

  try {
    await downloadToFile(video.b2_key, originalPath);
    const { codec, bitrateMbps, durationSeconds } = await probe(originalPath);

    const updates = { codec, bitrate_mbps: bitrateMbps };
    if (!video.duration_seconds && durationSeconds) updates.duration_seconds = durationSeconds;

    const needsFix = codec === 'hevc' || (bitrateMbps && bitrateMbps > BITRATE_THRESHOLD_MBPS);

    if (!needsFix) {
      await supabase.from('photos').update({ ...updates, web_video_key: video.b2_key }).eq('id', video.id);
      fs.unlinkSync(originalPath);
      return { status: 'already_fine' };
    }

    await transcode(originalPath, webPath);
    const webKey = `web/${video.b2_key}`;
    await uploadFromFile(webKey, webPath, 'video/mp4');

    // Reset cache_warmed_at here — the file web_video_key now points to is
    // genuinely NEW (never been fetched/cached before), so any existing
    // "recently warmed" timestamp from when it pointed at the original
    // would incorrectly cause the cache-warm job to skip it as not overdue.
    await supabase
      .from('photos')
      .update({ ...updates, web_video_key: webKey, cache_warmed_at: null })
      .eq('id', video.id);

    fs.unlinkSync(originalPath);
    fs.unlinkSync(webPath);
    return { status: 'transcoded' };
  } finally {
    if (fs.existsSync(originalPath)) fs.unlinkSync(originalPath);
    if (fs.existsSync(webPath)) fs.unlinkSync(webPath);
  }
}

// GitHub Actions runners have ~14GB total disk space. During transcoding,
// both the original AND its web copy must exist on disk simultaneously —
// for a large enough original, this can exceed the runner's entire
// capacity. Videos above this size are skipped here and left for a local
// run (which has much more free disk space) instead of risking a
// disk-full crash mid-job.
const MAX_SAFE_FILE_SIZE_BYTES = 8 * 1024 * 1024 * 1024; // 8GB — leaves
  // headroom for the OS, node_modules, and the transcoded output alongside it

async function run() {
  const { data: videos, error } = await supabase
    .from('photos')
    .select('id, b2_key, file_size, duration_seconds')
    .eq('media_type', 'video')
    .is('web_video_key', null)
    .order('taken_at', { ascending: false });

  if (error) throw new Error(error.message);

  const tooLargeForCI = videos.filter((v) => v.file_size && v.file_size > MAX_SAFE_FILE_SIZE_BYTES);
  const safeToProcess = videos.filter((v) => !v.file_size || v.file_size <= MAX_SAFE_FILE_SIZE_BYTES);

  if (tooLargeForCI.length > 0) {
    console.log(
      `${tooLargeForCI.length} video(s) exceed the safe size for this runner's disk space ` +
        `(>${MAX_SAFE_FILE_SIZE_BYTES / 1024 / 1024 / 1024}GB) — skipping here, process these locally instead.`
    );
  }

  console.log(`${safeToProcess.length} video(s) safe to process this run.`);

  if (safeToProcess.length === 0) {
    console.log('Nothing to do this run.');
    return;
  }

  const runStartMs = Date.now();
  let transcoded = 0;
  let alreadyFine = 0;
  let failed = 0;
  let attempted = 0;

  for (const video of safeToProcess) {
    const elapsedSeconds = (Date.now() - runStartMs) / 1000;
    const videoTimeoutMs = computeVideoTimeoutMs(video.file_size);

    // Check BEFORE starting: if this video's own worst-case timeout would
    // push total elapsed time past the run budget, stop here rather than
    // starting something that might get killed ungracefully by the
    // workflow's own hard timeout-minutes limit instead of exiting cleanly.
    if (elapsedSeconds + videoTimeoutMs / 1000 > MAX_RUN_BUDGET_SECONDS && attempted > 0) {
      console.log('\nStopping — next video could exceed the remaining run budget.');
      break;
    }

    attempted += 1;
    try {
      console.log(`  → processing ${video.b2_key} (timeout budget: ${Math.round(videoTimeoutMs / 1000)}s)...`);
      const result = await withTimeout(processOne(video), videoTimeoutMs, `processing ${video.b2_key}`);
      if (result.status === 'transcoded') transcoded += 1;
      else alreadyFine += 1;
      console.log(`✓ (${result.status}) ${video.b2_key} — ${Math.round((Date.now() - runStartMs) / 1000 / 60)} min elapsed`);
    } catch (err) {
      failed += 1;
      console.error(`✗ ${video.b2_key}: ${err.message}`);
    }
  }

  const stillRemaining = safeToProcess.length - attempted;
  console.log(`\nDone. ${transcoded} transcoded, ${alreadyFine} already fine, ${failed} failed, ${attempted} attempted.`);
  if (stillRemaining > 0) console.log(`${stillRemaining} more remain for the next scheduled run.`);
  if (tooLargeForCI.length > 0) console.log(`${tooLargeForCI.length} large video(s) still need local processing.`);
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Transcode run failed:', err);
    process.exit(1);
  });

