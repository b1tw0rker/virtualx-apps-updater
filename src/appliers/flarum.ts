import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { AppEntry } from "../types.js";

const execFileAsync = promisify(execFile);

/**
 * Flarum has no self-contained release archive: the flarum/flarum GitHub
 * releases ship only the source zipball (no vendor/ dependencies), and the
 * project is installed and upgraded exclusively through Composer. So, unlike
 * the overlay-based appliers (phpMyAdmin, Roundcube, Nextcloud, ...), this one
 * runs Flarum's official in-place upgrade procedure inside appsDir/app.folder:
 *
 *   composer update --no-dev -o   pulls the newest release allowed by the
 *                                 site's own composer.json constraint, keeping
 *                                 its installed extensions intact
 *   php flarum migrate            applies any database migrations
 *   php flarum cache:clear        clears the compiled/asset cache
 *
 * Because it works in place, config.php (the site's DB credentials/settings),
 * storage/, public/assets/ and every installed extension are preserved as-is -
 * there is nothing to overlay and no local config to guard against clobbering.
 *
 * newVersion is informational here (used by the orchestrator for the marker
 * rewrite/notification): Composer resolves the concrete version from the site's
 * constraint, so a new MAJOR release (e.g. 2.x while the site is pinned to ^1)
 * is intentionally not pulled by a plain `composer update` - a major upgrade
 * needs the root constraint bumped and an extension-compatibility review first
 * (the same major-version caveat the TYPO3/Nextcloud checkers carry).
 */
export async function applyFlarumUpdate(
  app: AppEntry,
  appsDir: string,
  _newVersion: string,
): Promise<void> {
  const cwd = path.join(appsDir, app.folder);

  await execFileAsync(
    "composer",
    ["update", "--no-dev", "--optimize-autoloader", "--no-interaction"],
    { cwd },
  );
  await execFileAsync("php", ["flarum", "migrate", "--no-interaction"], { cwd });
  await execFileAsync("php", ["flarum", "cache:clear"], { cwd });
}
