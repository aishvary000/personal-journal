

// extract-metadata.js
//
// Unified date + GPS extraction for BOTH photos and videos, using ExifTool
// (via exiftool-vendored) — the same tool underlying Lightroom, Immich, and
// most serious photo-management software. Replaces the separate exifr +
// ffprobe metadata-reading approach with one consistent tool.

import { ExifTool } from 'exiftool-vendored';
import fs from 'fs';
import os from 'os';
import path from 'path';

// ExifTool spawns a long-lived process under the hood — create ONE instance
// and reuse it across every file in a run, rather than spinning up a new
// process per photo. Call exiftool.end() once, when the whole script finishes.
const exiftool = new ExifTool();

const CAPTURE_TIMEZONE_OFFSET = '+05:30'; // IST — used only when no offset is
                                            // recorded in the file itself

export async function extractMetadata(buffer, originalFilename) {
  const ext = path.extname(originalFilename) || '.tmp';
  const tmpPath = path.join(os.tmpdir(), `meta-${Date.now()}${ext}`);
  fs.writeFileSync(tmpPath, buffer);

  try {
    const tags = await exiftool.read(tmpPath);

    // --- Date resolution ---
    // Photos: DateTimeOriginal. Videos: CreateDate (falls back to
    // MediaCreateDate/TrackCreateDate on some containers, which
    // exiftool-vendored also surfaces if present).
    const rawDate = tags.DateTimeOriginal || tags.CreateDate || null;
    let takenAt = null;

    if (rawDate) {
      if (rawDate.tzoffsetMinutes != null) {
        // the file actually recorded a timezone offset — trust it directly
        takenAt = rawDate.toDate().toISOString();
      } else {
        // no offset recorded — treat the wall-clock reading as IST
        const wallClock = rawDate.toString().slice(0, 19).replace(' ', 'T');
        takenAt = new Date(`${wallClock}${CAPTURE_TIMEZONE_OFFSET}`).toISOString();
      }
    }

    // --- GPS resolution ---
    // exiftool-vendored returns already-converted signed decimal degrees —
    // no manual DMS/N-S-E-W parsing needed.
    const latitude = typeof tags.GPSLatitude === 'number' ? tags.GPSLatitude : null;
    const longitude = typeof tags.GPSLongitude === 'number' ? tags.GPSLongitude : null;

    return { takenAt, latitude, longitude };
  } catch (err) {
    console.warn(`ExifTool read failed for ${originalFilename}: ${err.message}`);
    return { takenAt: null, latitude: null, longitude: null };
  } finally {
    fs.unlinkSync(tmpPath);
  }
}

// Call this once, when your whole sync run finishes (not per-file!), to let
// the underlying ExifTool process shut down cleanly.
export async function closeExifTool() {
  await exiftool.end();
}
