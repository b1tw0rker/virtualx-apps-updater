import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const MARKER_PREFIX = ".virtualx.";

/**
 * Overwrites the `.virtualx.<appKey>` marker file inside appsDir/folder with
 * the new version string, keeping the on-disk version convention in sync
 * after a successful update.
 */
export async function writeVersionMarker(
  appsDir: string,
  folder: string,
  newVersion: string,
): Promise<void> {
  const folderPath = path.join(appsDir, folder);
  const files = await readdir(folderPath, { withFileTypes: true });
  const marker = files.find(
    (file) => file.isFile() && file.name.startsWith(MARKER_PREFIX),
  );

  if (!marker) {
    throw new Error(`No .virtualx.* marker file found in ${folderPath}`);
  }

  await writeFile(path.join(folderPath, marker.name), `${newVersion}\n`, "utf8");
}
