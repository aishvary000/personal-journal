
// scripts/download-via-worker.js
//
// Downloads an original file through the photos.aishvary.dev Cloudflare
// Worker (using a signed URL, same mechanism the frontend uses) instead of
// hitting B2's S3 API directly via @aws-sdk/client-s3. The B2-to-Cloudflare
// hop this triggers qualifies for Bandwidth Alliance free egress — the same
// credit end-user photo views already get — whereas a direct SDK call to
// B2 bypasses Cloudflare entirely and counts as regular, non-favored egress.
//
// Only useful for DOWNLOADS — the Worker has no upload capability, so
// thumbnail uploads still go direct to B2 via PutObjectCommand as before.

import crypto from 'crypto';

function signUrl(key, expiresInSeconds = 300) {
  const expires = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const payload = `${key}:${expires}`;
  const signature = crypto
    .createHmac('sha256', process.env.PHOTO_SIGNING_SECRET)
    .update(payload)
    .digest('hex');
  return `https://photos.aishvary.dev/${key}?expires=${expires}&sig=${signature}`;
}

export async function downloadViaWorker(key) {
  const url = signUrl(key);
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Worker fetch failed for ${key}: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

