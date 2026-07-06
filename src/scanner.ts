import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { ScannedApp } from "./types.js";

const MARKER_PREFIX = ".virtualx.";

/**
 * Scans appsDir for immediate subdirectories that contain a `.virtualx.<appKey>`
 * marker file (the existing convention used across /var/virtualx/apps). Folders
 * without such a marker (e.g. _backups, sql) are not considered apps.
 */
export async function scanApps(appsDir: string): Promise<ScannedApp[]> {
  const entries = await readdir(appsDir, { withFileTypes: true });
  const folders = entries.filter((entry) => entry.isDirectory());

  const scanned: ScannedApp[] = [];
  for (const folder of folders) {
    const folderPath = path.join(appsDir, folder.name);
    const marker = await findMarkerFile(folderPath);
    if (!marker) continue;

    const version = await readVersion(path.join(folderPath, marker));
    scanned.push({
      folder: folder.name,
      markerFile: marker,
      appKey: marker.slice(MARKER_PREFIX.length),
      version,
    });
  }

  return scanned;
}

async function findMarkerFile(folderPath: string): Promise<string | null> {
  const files = await readdir(folderPath, { withFileTypes: true });
  const marker = files.find(
    (file) => file.isFile() && file.name.startsWith(MARKER_PREFIX),
  );
  return marker?.name ?? null;
}

async function readVersion(markerPath: string): Promise<string | null> {
  try {
    const content = await readFile(markerPath, "utf8");
    const trimmed = content.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}
