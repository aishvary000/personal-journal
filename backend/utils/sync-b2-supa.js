
// scripts/sync-photos-to-db.js
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { createClient } from '@supabase/supabase-js';

const s3 = new S3Client({
  endpoint: `https://s3.${process.env.B2_REGION}.backblazeb2.com`,
  region: process.env.B2_REGION,
  credentials: {
    accessKeyId: process.env.B2_KEY_ID,
    secretAccessKey: process.env.B2_APP_KEY,
  },
});

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);


async function listAllObjects() {
  let allObjects = [];
  let continuationToken = undefined;

  do {
    const response = await s3.send(new ListObjectsV2Command({
      Bucket: process.env.B2_BUCKET,
      ContinuationToken: continuationToken,
    }));
    allObjects = allObjects.concat(response.Contents || []);
    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  return allObjects;
}

async function sync() {
  const Contents = await listAllObjects();
  console.log(`Listed ${Contents.length} objects from B2 bucket ${process.env.B2_BUCKET}`);
  const realPhotos = Contents.filter((obj) => {
    const key = obj.Key;
    if (key.includes('.trashed-')) return false;
    if (key.endsWith('.bzEmpty')) return false;
    if (obj.Size === 0) return false;
    return true;
  });

  for (const obj of realPhotos
  ) {
    const b2Key = obj.Key;
    const takenAt = extractDateFromFilename(b2Key);

    if (!takenAt) {
      console.warn(`Skipping ${b2Key} — couldn't parse a date from filename`);
      continue;
    }

    console.log(`Upserting: ${b2Key} → taken_at: ${takenAt}`);

    const { error } = await supabase
      .from('photos')
      .upsert({ b2_key: b2Key, taken_at: takenAt }, { onConflict: 'b2_key' });

    if (error) console.error(`Failed to upsert ${b2Key}:`, error);
  }

  console.log(`Synced ${realPhotos.length} of ${Contents.length} listed objects.`);
}

function extractDateFromFilename(key) {
  const match = key.match(/(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}+05:30`).toISOString();
}

sync();
