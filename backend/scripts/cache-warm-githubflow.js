
// cache-warm.js
//
// Self-sustaining video cache warming. State lives in the DATABASE
// (cache_warmed_at column), not a local file — this matters specifically
// because GitHub Actions runners are ephemeral: every scheduled run starts
// from a fresh checkout, so a local progress file would be silently wiped
// between runs, making every run think nothing had ever been warmed.
//
// Each run: picks the most-overdue videos (never warmed, or warmed longest
// ago), skips anything warmed too recently, and stops once it's used its
// time budget for this run — leaving the rest for the next scheduled run.

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const MAX_RUN_BUDGET_SECONDS = Number(process.env.MAX_RUN_BUDGET_SECONDS) || 18000; // 5 hours
const MIN_REWARM_INTERVAL_DAYS = Number(process.env.MIN_REWARM_INTERVAL_DAYS) || 25; // don't
  // touch anything warmed more recently than this — avoids wastefully
  // re-warming videos that are still fresh, and means most weekly runs
  // will find little or nothing to do until things actually start aging out

function signPhotoUrl(key, expiresInSeconds = 3600) {
  const expires = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const payload = `${key}:${expires}`;
  const signature = crypto.createHmac('sha256', process.env.PHOTO_SIGNING_SECRET).update(payload).digest('hex');
  return `https://photos.aishvary.dev/${key}?expires=${expires}&sig=${signature}`;
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms)),
  ]);
}

function computeTimeoutMs(fileSizeBytes) {
  if (!fileSizeBytes) return 5 * 60 * 1000;
  const conservativeMbps = 10;
  const estimatedSeconds = (fileSizeBytes * 8) / (conservativeMbps * 1_000_000);
  return Math.max(estimatedSeconds * 1000 + 2 * 60 * 1000, 3 * 60 * 1000);
}

async function primeOne(video) {
  const url = signPhotoUrl(video.b2_key);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`status ${response.status}`);

  const reader = response.body.getReader();
  while (true) {
    const { done } = await reader.read();
    if (done) break;
  }
}

async function run() {
  const cutoff = new Date(Date.now() - MIN_REWARM_INTERVAL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // "Most overdue first": never-warmed (cache_warmed_at IS NULL) sort before
  // anything with a real timestamp when ordering ascending with nulls first,
  // then oldest-warmed comes next — exactly the priority order wanted.
  const { data: candidates, error } = await supabase
    .from('photos')
    .select('id, b2_key, file_size, cache_warmed_at')
    .eq('media_type', 'video')
    .or(`cache_warmed_at.is.null,cache_warmed_at.lt.${cutoff}`)
    .order('cache_warmed_at', { ascending: true, nullsFirst: true });

  if (error) throw new Error(error.message);

  console.log(`${candidates.length} video(s) are overdue for warming (never warmed, or warmed >${MIN_REWARM_INTERVAL_DAYS} days ago).`);

  if (candidates.length === 0) {
    console.log('Nothing to do this run — everything is sufficiently fresh.');
    return;
  }

  console.log(`Will keep warming overdue videos until this run's actual time budget (${Math.round(MAX_RUN_BUDGET_SECONDS / 60)} min) is used.`);

  const runStartMs = Date.now();
  let done = 0;
  let failed = 0;
  let attempted = 0;

  for (const video of candidates) {
    const elapsedSeconds = (Date.now() - runStartMs) / 1000;
    const timeoutMs = computeTimeoutMs(video.file_size);

    // Check REAL elapsed time, not a pre-computed estimate — this is what
    // lets the run use however much time is actually available (often far
    // more than a conservative per-video estimate would suggest, since
    // GitHub's real network is much faster than the 10 Mbps floor assumed
    // for safety) rather than stopping early based on a pessimistic guess.
    if (elapsedSeconds + timeoutMs / 1000 > MAX_RUN_BUDGET_SECONDS && attempted > 0) {
      console.log(`\nStopping — this video's worst-case timeout would exceed the remaining run budget.`);
      break;
    }

    attempted += 1;
    try {
      console.log(`  → warming ${video.b2_key} (timeout budget: ${Math.round(timeoutMs / 1000)}s)...`);
      await withTimeout(primeOne(video), timeoutMs, `warming ${video.b2_key}`);

      await supabase.from('photos').update({ cache_warmed_at: new Date().toISOString() }).eq('id', video.id);

      done += 1;
      console.log(`✓ (${done}) ${video.b2_key} — ${Math.round((Date.now() - runStartMs) / 1000 / 60)} min elapsed so far`);
    } catch (err) {
      failed += 1;
      console.error(`✗ ${video.b2_key}: ${err.message}`);
      // cache_warmed_at deliberately left unchanged — stays eligible for
      // retry on the next run
    }
  }

  const stillOverdue = candidates.length - attempted;
  const totalMinutes = Math.round((Date.now() - runStartMs) / 1000 / 60);
  console.log(`\nDone. ${done} warmed, ${failed} failed, ${attempted} attempted in ${totalMinutes} min (actual).`);
  if (stillOverdue > 0) {
    console.log(`${stillOverdue} more overdue video(s) remain for the next scheduled run.`);
  }
}

run()
  .then(() => {
    process.exit(0); // force exit — Supabase's client can keep an open
                       // realtime connection alive that Node would
                       // otherwise wait on indefinitely, even though our
                       // own work is genuinely finished
  })
  .catch((err) => {
    console.error('Cache warming failed:', err);
    process.exit(1);
  });

