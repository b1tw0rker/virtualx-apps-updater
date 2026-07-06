import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as tar from "tar";
import type { AppEntry } from "../types.js";
import { assertChecksum, downloadFile, sha256File } from "./downloadUtils.js";

const REPO = "roundcube/roundcubemail";

interface GithubReleaseAsset {
  name: string;
  digest?: string;
}

/**
 * Downloads the official "-complete" Roundcube distribution (already
 * includes vendor/ dependencies, no composer step needed), verifies it
 * against the sha256 digest GitHub publishes for the release asset, and
 * overlays it onto appsDir/app.folder.
 *
 * config/config.inc.php (the site's real config, as opposed to the shipped
 * config.inc.php.sample) is never overwritten if it already exists. Nothing
 * outside the new archive is deleted - this is a merge/overlay, not a
 * mirror, so stray local files are left alone.
 */
export async function applyRoundcubeUpdate(
  app: AppEntry,
  appsDir: string,
  newVersion: string,
): Promise<void> {
  const workDir = await mkdtemp(path.join(tmpdir(), "roundcube-update-"));

  try {
    const archiveName = `roundcubemail-${newVersion}-complete.tar.gz`;
    const archiveUrl = `https://github.com/${REPO}/releases/download/${newVersion}/${archiveName}`;
    const archivePath = path.join(workDir, archiveName);

    await downloadFile(archiveUrl, archivePath);
    await verifyChecksum(newVersion, archiveName, archivePath);

    const extractDir = path.join(workDir, "extracted");
    await mkdir(extractDir);
    await tar.extract({ file: archivePath, cwd: extractDir });

    const [topLevelEntry] = await readdir(extractDir);
    if (!topLevelEntry) {
      throw new Error(`Archive ${archiveName} did not contain any files`);
    }

    const sourceDir = path.join(extractDir, topLevelEntry);
    const targetDir = path.join(appsDir, app.folder);

    await cp(sourceDir, targetDir, {
      recursive: true,
      force: true,
      filter: (source) => {
        const relative = path.relative(sourceDir, source);
        if (relative !== path.join("config", "config.inc.php")) return true;
        return !existsSync(path.join(targetDir, relative));
      },
    });
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function verifyChecksum(
  version: string,
  archiveName: string,
  archivePath: string,
): Promise<void> {
  const response = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/${version}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "virtualx-apps-updater",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch release metadata for ${REPO}@${version}: ${response.status} ${response.statusText}`,
    );
  }

  const release = (await response.json()) as { assets: GithubReleaseAsset[] };
  const asset = release.assets.find((a) => a.name === archiveName);
  const digest = asset?.digest;
  if (!digest?.startsWith("sha256:")) {
    throw new Error(
      `No sha256 digest published by GitHub for ${archiveName} on release ${version}`,
    );
  }

  assertChecksum(archiveName, digest.slice("sha256:".length), await sha256File(archivePath));
}
