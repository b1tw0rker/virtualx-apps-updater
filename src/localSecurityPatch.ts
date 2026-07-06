import { chown, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import semver from "semver";
import { applyPhpMyAdminUpdate } from "./appliers/phpMyAdmin.js";
import { createBackup } from "./backup.js";
import { writeVersionMarker } from "./marker.js";
import type { AppEntry, UpdateResult } from "./types.js";

const MARKER_PREFIX = ".virtualx.";
const DBX_RELATIVE_PATH = path.join("htdocs", "dbx");

export interface LocalSecurityPatchOptions {
  httpdDir: string;
  backupsDir: string;
  /** Latest available phpMyAdmin version, e.g. from the dbx whitelist entry's checker. */
  latestVersion: string;
  dryRun: boolean;
}

/**
 * Scans `<httpdDir>/<domain>/htdocs/dbx` for locally hosted phpMyAdmin copies
 * (separate from the main /var/virtualx/apps instance) and, for each one that
 * is behind by a same-major.minor patch release only, backs it up, overlays
 * the new version and restores its original file ownership - all other
 * appliers assume they're the only writer touching appsDir, but here every
 * site keeps its own uid/gid (typically its hosting user), so this has to be
 * captured before the overlay and reapplied after.
 *
 * Minor/major version jumps are reported but never applied automatically -
 * this is a security-patch-only mechanism, not a general updater.
 */
export async function applyLocalSecurityPatches(
  options: LocalSecurityPatchOptions,
): Promise<UpdateResult[]> {
  const instances = await findLocalDbxInstances(options.httpdDir);
  const results: UpdateResult[] = [];

  for (const folder of instances) {
    const folderPath = path.join(options.httpdDir, folder);
    const currentVersion = await readMarkerVersion(folderPath);

    if (!currentVersion) {
      console.warn(
        `[localSecurityPatch] No .virtualx.phpmyadmin marker with a version found in ${folderPath} - skipping. Create one with the currently installed version to enable patching.`,
      );
      continue;
    }

    const normalizedCurrent = semver.coerce(currentVersion)?.version;
    if (!normalizedCurrent) {
      console.warn(
        `[localSecurityPatch] Could not parse version "${currentVersion}" in ${folderPath} - skipping.`,
      );
      continue;
    }

    if (!semver.gt(options.latestVersion, normalizedCurrent)) {
      console.log(`[localSecurityPatch] ${folder} is up to date (${currentVersion}).`);
      continue;
    }

    const isPatchOnly =
      semver.major(options.latestVersion) === semver.major(normalizedCurrent) &&
      semver.minor(options.latestVersion) === semver.minor(normalizedCurrent);

    if (!isPatchOnly) {
      console.log(
        `[localSecurityPatch] ${folder}: ${currentVersion} -> ${options.latestVersion} is a minor/major jump, not a patch-only security release - skipping, needs manual review.`,
      );
      continue;
    }

    console.log(
      `[localSecurityPatch] Security patch available for ${folder}: ${currentVersion} -> ${options.latestVersion}`,
    );

    if (options.dryRun) {
      console.log(`[localSecurityPatch] Dry run: skipping backup/apply for ${folder}.`);
      continue;
    }

    const { uid, gid } = await stat(folderPath);
    const app: AppEntry = { folder, name: "phpMyAdmin", enabled: true };

    await createBackup(options.httpdDir, options.backupsDir, folder, currentVersion);
    await applyPhpMyAdminUpdate(app, options.httpdDir, options.latestVersion);
    await restoreOwnership(folderPath, uid, gid);
    await writeVersionMarker(options.httpdDir, folder, options.latestVersion);

    results.push({ app, previousVersion: currentVersion, newVersion: options.latestVersion });
  }

  return results;
}

/** Returns each `<domain>/htdocs/dbx` path (relative to httpdDir) that exists. */
async function findLocalDbxInstances(httpdDir: string): Promise<string[]> {
  let domains: string[];
  try {
    domains = (await readdir(httpdDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }

  const found: string[] = [];
  for (const domain of domains) {
    const candidate = path.join(domain, DBX_RELATIVE_PATH);
    if (await isDirectory(path.join(httpdDir, candidate))) {
      found.push(candidate);
    }
  }
  return found;
}

async function isDirectory(dirPath: string): Promise<boolean> {
  try {
    return (await stat(dirPath)).isDirectory();
  } catch {
    return false;
  }
}

async function readMarkerVersion(folderPath: string): Promise<string | null> {
  const files = await readdir(folderPath, { withFileTypes: true });
  const marker = files.find(
    (file) => file.isFile() && file.name === `${MARKER_PREFIX}phpmyadmin`,
  );
  if (!marker) return null;

  const content = await readFile(path.join(folderPath, marker.name), "utf8");
  const trimmed = content.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Recursively chowns targetDir back to uid/gid - the overlay writes new files
 * as the process' own user (root), which would otherwise leave the site's
 * files owned by root instead of its hosting user.
 */
async function restoreOwnership(targetDir: string, uid: number, gid: number): Promise<void> {
  await chown(targetDir, uid, gid);
  const entries = await readdir(targetDir, { recursive: true });
  await Promise.all(entries.map((entry) => chown(path.join(targetDir, entry), uid, gid)));
}
