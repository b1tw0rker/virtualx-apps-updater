import type { AppEntry } from "../types.js";

export class NotImplementedError extends Error {}

type Applier = (app: AppEntry, appsDir: string, newVersion: string) => Promise<void>;

// No app-specific updater is implemented yet. This is the extension point for
// downloading and installing a new version per app type (e.g. phpMyAdmin:
// download the release tarball, extract it over dbx/ while preserving
// config.inc.php, then rewrite .virtualx.phpmyadmin).
const APPLIERS: Record<string, Applier> = {};

/**
 * Applies an update for the given app. Throws NotImplementedError until a
 * concrete applier is registered for app.folder - the update-check, backup
 * and notification pipeline works today, but the actual file replacement
 * per app type is intentionally left as follow-up work (see project README).
 */
export async function applyUpdate(
  app: AppEntry,
  appsDir: string,
  newVersion: string,
): Promise<void> {
  const applier = APPLIERS[app.folder];
  if (!applier) {
    throw new NotImplementedError(
      `No updater implemented yet for "${app.name}" (${app.folder}). Register one in src/appliers/applyUpdate.ts.`,
    );
  }
  await applier(app, appsDir, newVersion);
}
