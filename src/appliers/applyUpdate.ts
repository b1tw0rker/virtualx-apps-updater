import type { AppEntry } from "../types.js";
import { applyPhpMyAdminUpdate } from "./phpMyAdmin.js";
import { applyRoundcubeUpdate } from "./roundcube.js";

export class NotImplementedError extends Error {}

type Applier = (app: AppEntry, appsDir: string, newVersion: string) => Promise<void>;

// Extension point for downloading and installing a new version per app type.
// Apps without an entry here still get detection/backup/notification, but
// applyUpdate() throws NotImplementedError for them until one is added.
const APPLIERS: Record<string, Applier> = {
  dbx: applyPhpMyAdminUpdate,
  mailx: applyRoundcubeUpdate,
};

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
