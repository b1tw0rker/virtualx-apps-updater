import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { ScannedApp } from "./types.js";

const MARKER_PREFIX = ".virtualx.";

// New apps are onboarded directly under this subfolder (existing apps still
// living straight under APPS_DIR, e.g. dbx/mailx, are migrated in later).
const INSTANCES_DIR = "_instances";

/**
 * Scans appsDir for immediate subdirectories that contain a `.virtualx.<appKey>`
 * marker file (the existing convention used across /var/virtualx/apps), plus
 * one level into `_instances/` where newly onboarded apps live. Folders
 * without such a marker (e.g. _backups, sql) are not considered apps.
 */
export async function scanApps(appsDir: string): Promise<ScannedApp[]> {
  const scanned = await scanAppsIn(appsDir);

  const instancesPath = path.join(appsDir, INSTANCES_DIR);
  if (await isDirectory(instancesPath)) {
    scanned.push(...(await scanAppsIn(instancesPath, INSTANCES_DIR)));
  }

  return scanned;
}

async function scanAppsIn(dir: string, folderPrefix?: string): Promise<ScannedApp[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const folders = entries.filter((entry) => entry.isDirectory());

  const scanned: ScannedApp[] = [];
  for (const folder of folders) {
    const folderPath = path.join(dir, folder.name);
    const marker = await findMarkerFile(folderPath);
    if (!marker) continue;

    const version = await readVersion(path.join(folderPath, marker));
    scanned.push({
      folder: folderPrefix ? path.join(folderPrefix, folder.name) : folder.name,
      markerFile: marker,
      appKey: marker.slice(MARKER_PREFIX.length),
      version,
    });
  }

  return scanned;
}

async function isDirectory(dirPath: string): Promise<boolean> {
  try {
    return (await stat(dirPath)).isDirectory();
  } catch {
    return false;
  }
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
