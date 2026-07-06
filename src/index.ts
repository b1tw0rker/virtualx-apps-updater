#!/usr/bin/env node
import { Command } from "commander";
import { config } from "./config.js";
import { deployToServer } from "./deploy.js";
import { runUpdateCycle } from "./orchestrator.js";
import { scanApps } from "./scanner.js";
import { loadOrInitWhitelist } from "./whitelist.js";

const program = new Command();

program
  .name("virtualx-apps-updater")
  .description("Scans, updates and deploys /var/virtualx/apps");

program
  .command("scan")
  .description("Scan APPS_DIR and (re)write config/apps.json with any newly discovered apps")
  .action(async () => {
    const scanned = await scanApps(config.appsDir);
    const whitelist = await loadOrInitWhitelist(config.whitelistPath, scanned);
    console.table(
      whitelist.map((app) => ({
        folder: app.folder,
        name: app.name,
        enabled: app.enabled,
        source: app.source?.type ?? "-",
      })),
    );
  });

program
  .command("run")
  .description("Check whitelisted apps for updates, apply them, notify and deploy")
  .option("--dry-run", "Only report available updates, do not change or deploy anything", false)
  .action(async (opts: { dryRun: boolean }) => {
    const results = await runUpdateCycle({ dryRun: opts.dryRun });
    console.log(`[cli] Done. ${results.length} app(s) updated.`);
  });

program
  .command("deploy")
  .description("Deploy APPS_DIR to the configured target server, independent of the update cycle")
  .action(async () => {
    await deployToServer({
      localPath: config.appsDir,
      host: config.deploy.host,
      remotePath: config.deploy.remotePath,
      sshKeyPath: config.deploy.sshKeyPath,
    });
    console.log(`[cli] Deployed ${config.appsDir} to ${config.deploy.host}:${config.deploy.remotePath}`);
  });

program.parseAsync(process.argv).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
