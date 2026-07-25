// scripts/build-clusters.js
//
// Groups photos into "Moments" — sequential runs of photos close together in
// time AND (when GPS is available) close together in location. Recomputes
// ALL clusters from scratch every run — simple, safe to re-run anytime as
// your library grows, no incremental-update complexity to get wrong.
//
// Run with: node --env-file=.env scripts/build-clusters.js

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const TIME_GAP_MS = 3 * 60 * 60 * 1000; // 3 hours — longer gap starts a new cluster
const DISTANCE_KM_THRESHOLD = 2; // 2km — bigger jump starts a new cluster (only
                                   // checked when both photos have GPS)
const PAGE_SIZE = 1000;

// Haversine formula — great-circle distance between two lat/long points, in km
function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Averages the GPS coordinates of every photo in a cluster that actually has
// one, giving a single representative point for the whole event.
function computeCenterPoint(group) {
  const withGps = group.filter((p) => p.latitude != null && p.longitude != null);
  if (withGps.length === 0) return { latitude: null, longitude: null };

  const latitude = withGps.reduce((sum, p) => sum + p.latitude, 0) / withGps.length;
  const longitude = withGps.reduce((sum, p) => sum + p.longitude, 0) / withGps.length;
  return { latitude, longitude };
}

// Nominatim's free reverse-geocoding API — no key needed, but usage policy
// requires: max 1 request/second, and a descriptive User-Agent identifying
// the app (not the default Node/fetch one, which gets blocked).
async function reverseGeocode(latitude, longitude) {
  if (latitude == null || longitude == null) return null;

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=10`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'personal-journal-app/1.0 (personal use, github.com/aishvary)' },
    });

    if (!response.ok) return null;
    const data = await response.json();

    // zoom=10 gives city/town-level detail rather than a precise street address —
    // more appropriate for labeling a whole event than an exact pinpoint
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

async function fetchAllPhotos() {
  let allRows = [];
  let from = 0;

  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from('photos')
      .select('id, taken_at, latitude, longitude')
      .not('taken_at', 'is', null)
      .order('taken_at', { ascending: true })
      .range(from, to);

    if (error) throw new Error(error.message);
    allRows = allRows.concat(data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return allRows;
}

function buildClusterGroups(photos) {
  const groups = [];
  let current = [];

  for (const photo of photos) {
    if (current.length === 0) {
      current.push(photo);
      continue;
    }

    const prev = current[current.length - 1];
    const timeDiff = new Date(photo.taken_at) - new Date(prev.taken_at);

    let shouldStartNew = timeDiff > TIME_GAP_MS;

    if (!shouldStartNew && photo.latitude != null && prev.latitude != null) {
      const dist = distanceKm(prev.latitude, prev.longitude, photo.latitude, photo.longitude);
      if (dist > DISTANCE_KM_THRESHOLD) shouldStartNew = true;
    }

    if (shouldStartNew) {
      groups.push(current);
      current = [photo];
    } else {
      current.push(photo);
    }
  }

  if (current.length > 0) groups.push(current);
  return groups;
}

async function run() {
  console.log('Fetching all dated photos...');
  const photos = await fetchAllPhotos();
  console.log(`Found ${photos.length} photo(s) with a date.`);

  const groups = buildClusterGroups(photos);
  console.log(`Grouped into ${groups.length} cluster(s).`);

  // Clear existing cluster assignments before rebuilding, so a re-run never
  // leaves stale/orphaned clusters behind
  await supabase.from('photos').update({ cluster_id: null }).not('cluster_id', 'is', null);
  await supabase.from('clusters').delete().neq('id', 0); // delete all rows

  let created = 0;

  for (const group of groups) {
    const startDate = group[0].taken_at;
    const endDate = group[group.length - 1].taken_at;
    const coverPhotoId = group[0].id;
    const { latitude, longitude } = computeCenterPoint(group);

    let placeName = null;
    if (latitude != null) {
      placeName = await reverseGeocode(latitude, longitude);
      await sleep(1100); // respect Nominatim's 1 request/second usage policy
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

    const photoIds = group.map((p) => p.id);
    const { error: updateError } = await supabase
      .from('photos')
      .update({ cluster_id: cluster.id })
      .in('id', photoIds);

    if (updateError) {
      console.error(`Failed to assign cluster ${cluster.id} to its photos:`, updateError.message);
      continue;
    }

    created += 1;
  }

  console.log(`Done. Created ${created} cluster(s).`);
}

run().catch((err) => {
  console.error('Clustering failed:', err);
  process.exitCode = 1;
});
