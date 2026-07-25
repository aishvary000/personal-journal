
// extract-metadata.js
//
// Unified date + GPS extraction for BOTH photos and videos, using ExifTool
// (via exiftool-vendored) — the same tool underlying Lightroom, Immich, and
// most serious photo-management software. Replaces the separate exifr +
// ffprobe metadata-reading approach with one consistent tool.

import { ExifTool } from 'exiftool-vendored';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

// ExifTool spawns a long-lived process under the hood — create ONE instance
// and reuse it across every file in a run, rather than spinning up a new
// process per photo. Call exiftool.end() once, when the whole script finishes.
const exiftool = new ExifTool();

const CAPTURE_TIMEZONE_OFFSET = '+05:30'; // IST — used only when no offset is
                                            // recorded in the file itself

function emptyResult() {
  return {
    takenAt: null,
    latitude: null,
    longitude: null,
    cameraMake: null,
    cameraModel: null,
    width: null,
    height: null,
    durationSeconds: null,
    orientation: null,
    checksum: null,
    fileSize: null,
    iso: null,
    aperture: null,
    shutterSpeed: null,
    focalLength: null,
    gpsAltitude: null,
  };
}

export async function extractMetadata(buffer, originalFilename) {
  const ext = path.extname(originalFilename) || '.tmp';
  const tmpPath = path.join(os.tmpdir(), `meta-${Date.now()}${ext}`);
  fs.writeFileSync(tmpPath, buffer);

  // Not from ExifTool at all — computed directly from the raw bytes. Cheap,
  // and enables exact-duplicate detection (different from phash's
  // near-duplicate detection) plus future integrity verification.
  const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
  const fileSize = buffer.length;

  try {
    const tags = await exiftool.read(tmpPath);

    // --- Date resolution ---
    const rawDate = tags.DateTimeOriginal || tags.CreateDate || null;
    let takenAt = null;

    if (rawDate) {
      if (rawDate.tzoffsetMinutes != null) {
        takenAt = rawDate.toDate().toISOString();
      } else {
        const wallClock = rawDate.toString().slice(0, 19).replace(' ', 'T');
        takenAt = new Date(`${wallClock}${CAPTURE_TIMEZONE_OFFSET}`).toISOString();
      }
    }
    // --- GPS resolution ---
    const latitude = typeof tags.GPSLatitude === 'number' ? tags.GPSLatitude : null;
    const longitude = typeof tags.GPSLongitude === 'number' ? tags.GPSLongitude : null;
    const gpsAltitude = typeof tags.GPSAltitude === 'number' ? tags.GPSAltitude : null;

    // --- Camera/file info ---
    const cameraMake = tags.Make || null;
    const cameraModel = tags.Model || null;
    const width = tags.ImageWidth || tags.ExifImageWidth || null;
    const height = tags.ImageHeight || tags.ExifImageHeight || null;
    const durationSeconds = typeof tags.Duration === 'number' ? tags.Duration : null;
    const orientation = typeof tags.Orientation === 'number' ? tags.Orientation : null;

    // --- Camera settings (the "exposure triangle" + focal length) ---
    const iso = typeof tags.ISO === 'number' ? tags.ISO : null;
    const aperture = typeof tags.FNumber === 'number' ? tags.FNumber : null;
    // ExposureTime comes back as decimal seconds (e.g. 0.004 for a 1/250s shot)
    const shutterSpeed = typeof tags.ExposureTime === 'number' ? tags.ExposureTime : null;
    const focalLength = typeof tags.FocalLength === 'number' ? tags.FocalLength : null;

    return {
      takenAt,
      latitude,
      longitude,
      cameraMake,
      cameraModel,
      width,
      height,
      durationSeconds,
      orientation,
      checksum,
      fileSize,
      iso,
      aperture,
      shutterSpeed,
      focalLength,
      gpsAltitude,
    };
  } catch (err) {
    console.warn(`ExifTool read failed for ${originalFilename}: ${err.message}`);
    // still return the checksum/fileSize even if ExifTool itself failed —
    // those come from the raw bytes, not from ExifTool, so there's no reason
    // to lose them just because metadata parsing had an issue
    return { ...emptyResult(), checksum, fileSize };
  } finally {
    fs.unlinkSync(tmpPath);
  }
}

// Call this once, when your whole sync run finishes (not per-file!), to let
// the underlying ExifTool process shut down cleanly.
export async function closeExifTool() {
  await exiftool.end();
}
