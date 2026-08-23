
// scripts/build-clusters.js
//
// INCREMENTAL version — only processes photos that don't have a cluster_id
// yet. Previously this rebuilt everything from scratch every run: wiped all
// clusters, re-assigned every photo, and re-geocoded every single cluster
// again (including Nominatim's 1.1s rate-limit sleep per cluster) even for
// clusters that hadn't changed at all. This version only touches what's
// actually new.
//
// Run with: node --env-file=.env scripts/build-clusters.js

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const TIME_GAP_MS = 3 * 60 * 60 * 1000; // 3 hours
const DISTANCE_KM_THRESHOLD = 2; // 2km
const PAGE_SIZE = 1000;

function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function computeCenterPoint(group) {
  const withGps = group.filter((p) => p.latitude != null && p.longitude != null);
  if (withGps.length === 0) return { latitude: null, longitude: null };
  const latitude = withGps.reduce((sum, p) => sum + p.latitude, 0) / withGps.length;
  const longitude = withGps.reduce((sum, p) => sum + p.longitude, 0) / withGps.length;
  return { latitude, longitude };
}

async function reverseGeocode(latitude, longitude) {
  if (latitude == null || longitude == null) return null;
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=10`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'personal-journal-app/1.0 (personal use, github.com/aishvary)' },
    });
    if (!response.ok) return null;
    const data = await response.json();
    const address = data.address || {};
    return address.city || address.town || address.village || address.county || data.display_name || null;
  } catch (err) {
    console.warn(`Reverse geocoding failed for ${latitude},${longitude}: ${err.message}`);
    return null;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Fetches ONLY photos not yet assigned to a cluster — this is the key
// change that avoids reprocessing your whole library every run.
async function fetchUnclusteredPhotos() {
  let allRows = [];
  let from = 0;
  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from('photos')
      .select('id, taken_at, latitude, longitude')
      .not('taken_at', 'is', null)
      .is('cluster_id', null)
      .order('taken_at', { ascending: true })
      .range(from, to);
    if (error) throw new Error(error.message);
    allRows = allRows.concat(data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return allRows;
}

// The most recently-ending existing cluster, plus its last photo's
// coordinates — used to decide whether the first new photo should EXTEND
// that cluster rather than start a brand new one.
async function fetchMostRecentCluster() {
  const { data: cluster } = await supabase
    .from('clusters')
    .select('*')
    .order('end_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!cluster) return null;

  const { data: lastPhoto } = await supabase
    .from('photos')
    .select('id, taken_at, latitude, longitude')
    .eq('cluster_id', cluster.id)
    .order('taken_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return { cluster, lastPhoto };
}

async function run() {
  console.log('Fetching unclustered photos...');
  const photos = await fetchUnclusteredPhotos();
  console.log(`Found ${photos.length} unclustered photo(s).`);

  if (photos.length === 0) {
    console.log('Nothing new to cluster.');
    return;
  }

  const recent = await fetchMostRecentCluster();

  // Determine whether the very first new photo extends the most recent
  // existing cluster, or starts a fresh one.
  let extendCluster = null;
  let remainingPhotos = photos;

  if (recent?.lastPhoto) {
    const first = photos[0];
    const timeDiff = new Date(first.taken_at) - new Date(recent.lastPhoto.taken_at);
    let fits = timeDiff <= TIME_GAP_MS;
    if (fits && first.latitude != null && recent.lastPhoto.latitude != null) {
      const dist = distanceKm(
        recent.lastPhoto.latitude, recent.lastPhoto.longitude,
        first.latitude, first.longitude
      );
      if (dist > DISTANCE_KM_THRESHOLD) fits = false;
    }
    if (fits) extendCluster = recent.cluster;
  }

  // Walk through the new photos, grouping sequentially exactly like before,
  // but seeded with the boundary photo so the very first group can
  // correctly decide to extend rather than always starting fresh.
  const groups = [];
  let current = [];
  let previous = recent?.lastPhoto || null;

  for (const photo of remainingPhotos) {
    if (previous) {
      const timeDiff = new Date(photo.taken_at) - new Date(previous.taken_at);
      let shouldStartNew = timeDiff > TIME_GAP_MS;
      if (!shouldStartNew && photo.latitude != null && previous.latitude != null) {
        const dist = distanceKm(previous.latitude, previous.longitude, photo.latitude, photo.longitude);
        if (dist > DISTANCE_KM_THRESHOLD) shouldStartNew = true;
      }
      if (shouldStartNew && current.length > 0) {
        groups.push(current);
        current = [photo];
      } else {
        current.push(photo);
      }
    } else {
      current.push(photo);
    }
    previous = photo;
  }
  if (current.length > 0) groups.push(current);

  let extended = 0;
  let created = 0;

  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    const photoIds = group.map((p) => p.id);

    // The FIRST group only extends the existing cluster if we determined
    // above that the boundary genuinely fits — every group after that is
    // always new, since by definition a gap was detected to start it.
    if (i === 0 && extendCluster) {
      const newEndDate = group[group.length - 1].taken_at;

      const { error: updateClusterError } = await supabase
        .from('clusters')
        .update({
          end_date: newEndDate,
          photo_count: extendCluster.photo_count + group.length,
        })
        .eq('id', extendCluster.id);

      if (updateClusterError) {
        console.error('Failed to extend cluster:', updateClusterError.message);
        continue;
      }

      await supabase.from('photos').update({ cluster_id: extendCluster.id }).in('id', photoIds);
      extended += 1;
      console.log(`Extended existing cluster ${extendCluster.id} with ${group.length} photo(s).`);
      continue;
    }

    // Every other group is a genuinely NEW cluster — this is the only case
    // that needs a fresh reverse-geocode call.
    const startDate = group[0].taken_at;
    const endDate = group[group.length - 1].taken_at;
    const coverPhotoId = group[0].id;
    const { latitude, longitude } = computeCenterPoint(group);

    let placeName = null;
    if (latitude != null) {
      placeName = await reverseGeocode(latitude, longitude);
      await sleep(1100); // Nominatim's usage policy — only paid for NEW clusters now
    }

    const { data: cluster, error } = await supabase
      .from('clusters')
      .insert({
        start_date: startDate,
        end_date: endDate,
        photo_count: group.length,
        cover_photo_id: coverPhotoId,
        center_latitude: latitude,
        center_longitude: longitude,
        place_name: placeName,
      })
      .select('id')
      .single();

    if (error) {
      console.error('Failed to create cluster:', error.message);
      continue;
    }

    await supabase.from('photos').update({ cluster_id: cluster.id }).in('id', photoIds);
    created += 1;
  }

  console.log(`Done. Extended ${extended} existing cluster(s), created ${created} new one(s).`);
}

run().catch((err) => {
  console.error('Clustering failed:', err);
  process.exitCode = 1;
});


