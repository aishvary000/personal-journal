import crypto from "crypto";

export function signPhotoUrl(b2Key, expiresInSeconds = 300) {
  const expires = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const payload = `${b2Key}:${expires}`;
  const signature = crypto
    .createHmac('sha256', process.env.PHOTO_SIGNING_SECRET)
    .update(payload)
    .digest('hex');

  return `https://photos.aishvary.dev/${b2Key}?expires=${expires}&sig=${signature}`;
}