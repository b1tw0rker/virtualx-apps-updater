import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import * as tar from "tar";
import type { AppEntry } from "../types.js";

const DIST_BASE = "https://files.phpmyadmin.net/phpMyAdmin";

/**
 * Downloads the official "-all-languages" phpMyAdmin distribution (already
 * includes vendor/ and locales, no composer step needed), verifies its
 * published sha256 checksum, and overlays it onto appsDir/dbx.
 *
 * config.inc.php is never overwritten if it already exists, so the site's
 * local database/auth configuration survives the update. Nothing outside
 * the new archive is deleted - this is a merge/overlay, not a mirror, so
 * stray local files are left alone.
 */
export async function applyPhpMyAdminUpdate(
  _app: AppEntry,
  appsDir: string,
  newVersion: string,
): Promise<void> {
  const workDir = await mkdtemp(path.join(tmpdir(), "phpmyadmin-update-"));

  try {
    const archiveName = `phpMyAdmin-${newVersion}-all-languages.tar.gz`;
    const archiveUrl = `${DIST_BASE}/${newVersion}/${archiveName}`;
    const archivePath = path.join(workDir, archiveName);

    await downloadFile(archiveUrl, archivePath);
    await verifyChecksum(archiveUrl, archivePath);

    const extractDir = path.join(workDir, "extracted");
    await mkdir(extractDir);
    await tar.extract({ file: archivePath, cwd: extractDir });

    const [topLevelEntry] = await readdir(extractDir);
    if (!topLevelEntry) {
      throw new Error(`Archive ${archiveName} did not contain any files`);
    }

    const sourceDir = path.join(extractDir, topLevelEntry);
    const targetDir = path.join(appsDir, "dbx");

    await cp(sourceDir, targetDir, {
      recursive: true,
      force: true,
      filter: (source) => {
        if (path.basename(source) !== "config.inc.php") return true;
        const destination = path.join(targetDir, path.relative(sourceDir, source));
        return !existsSync(destination);
      },
    });
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function downloadFile(url: string, destination: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination));
}

async function verifyChecksum(archiveUrl: string, archivePath: string): Promise<void> {
  const response = await fetch(`${archiveUrl}.sha256`);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch checksum for ${archiveUrl}: ${response.status} ${response.statusText}`,
    );
  }

  const expected = (await response.text()).trim().split(/\s+/)[0];
  if (!expected) {
    throw new Error(`Checksum file for ${archiveUrl} was empty or malformed`);
  }

  const hash = createHash("sha256");
  await pipeline(createReadStream(archivePath), hash);
  const actual = hash.digest("hex");

  if (actual !== expected) {
    throw new Error(
      `Checksum mismatch for ${archiveUrl}: expected ${expected}, got ${actual}`,
    );
  }
}
