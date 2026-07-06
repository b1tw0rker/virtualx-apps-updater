import semver from "semver";
import { applyUpdate, NotImplementedError } from "./appliers/applyUpdate.js";
import { createBackup } from "./backup.js";
import { createChecker } from "./checkers/createChecker.js";
import { config } from "./config.js";
import { deployToServer } from "./deploy.js";
import { WhatsAppNotifier } from "./notify/WhatsAppNotifier.js";
import type { Notifier } from "./notify/Notifier.js";
import { scanApps } from "./scanner.js";
import type { UpdateResult } from "./types.js";
import { loadOrInitWhitelist } from "./whitelist.js";
import { writeVersionMarker } from "./marker.js";

export interface RunOptions {
  dryRun: boolean;
}

export async function runUpdateCycle(options: RunOptions): Promise<UpdateResult[]> {
  const scanned = await scanApps(config.appsDir);
  const whitelist = await loadOrInitWhitelist(config.whitelistPath, scanned);
  const versionByFolder = new Map(scanned.map((s) => [s.folder, s.version]));

  const results: UpdateResult[] = [];
  let notifier: Notifier | undefined;

  for (const app of whitelist) {
    if (!app.enabled) continue;

    if (!app.source) {
      console.log(
        `[orchestrator] Skipping ${app.name} (${app.folder}): no update source configured.`,
      );
      continue;
    }

    const currentVersion = versionByFolder.get(app.folder) ?? null;
    const latestVersion = await createChecker(app.source).getLatestVersion();

    if (!latestVersion) {
      console.warn(`[orchestrator] Could not determine latest version for ${app.name}.`);
      continue;
    }

    if (currentVersion && !semver.gt(latestVersion, currentVersion)) {
      console.log(`[orchestrator] ${app.name} is up to date (${currentVersion}).`);
      continue;
    }

    console.log(
      `[orchestrator] Update available for ${app.name}: ${currentVersion ?? "unknown"} -> ${latestVersion}`,
    );

    if (options.dryRun) {
      console.log(`[orchestrator] Dry run: skipping backup/apply/notify for ${app.name}.`);
      continue;
    }

    await createBackup(config.appsDir, config.backupsDir, app.folder, currentVersion ?? "unknown");

    try {
      await applyUpdate(app, config.appsDir, latestVersion);
    } catch (error) {
      if (error instanceof NotImplementedError) {
        console.warn(`[orchestrator] ${error.message} (backup was created, no files changed)`);
      } else {
        console.error(`[orchestrator] Applying update for ${app.name} failed:`, error);
      }
      continue;
    }

    await writeVersionMarker(config.appsDir, app.folder, latestVersion);
    results.push({ app, previousVersion: currentVersion, newVersion: latestVersion });

    notifier ??= new WhatsAppNotifier(config.whatsapp.authDir, config.whatsapp.targetNumber);
    await notifier.send(
      `✅ ${app.name} wurde von ${currentVersion ?? "unbekannt"} auf ${latestVersion} aktualisiert (${app.folder}).`,
    );
  }

  if (results.length > 0 && !options.dryRun) {
    await deployToServer({
      localPath: config.appsDir,
      host: config.deploy.host,
      remotePath: config.deploy.remotePath,
      sshKeyPath: config.deploy.sshKeyPath,
    });

    notifier ??= new WhatsAppNotifier(config.whatsapp.authDir, config.whatsapp.targetNumber);
    await notifier.send(
      `🚀 Deploy nach ${config.deploy.host} abgeschlossen (${results.length} App(s) aktualisiert).`,
    );
  }

  await notifier?.close();
  return results;
}
