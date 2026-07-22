import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as tar from "tar";
import type { AppEntry } from "../types.js";
import { downloadFile, verifyGithubReleaseChecksum } from "./downloadUtils.js";

const REPO = "roundcube/roundcubemail";

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
    await verifyGithubReleaseChecksum(REPO, newVersion, archiveName, archivePath);

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
