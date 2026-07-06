#!/usr/bin/env node
import path from "node:path";
import { Command } from "commander";
import QRCode from "qrcode";
import qrcodeTerminal from "qrcode-terminal";
import { config } from "./config.js";
import { deployToServer } from "./deploy.js";
import { WhatsAppNotifier } from "./notify/WhatsAppNotifier.js";
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
    // Baileys keeps an internal keep-alive timer running even after the
    // socket is closed, which would otherwise leave this process hanging
    // forever once at least one WhatsApp message was sent - fatal for a
    // cron-triggered run.
    process.exit(0);
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

program
  .command("pair")
  .description(
    "Pair the WhatsApp session (writes a scannable QR to pairing-qr.png) and send a test message once connected",
  )
  .action(async () => {
    const qrPngPath = path.resolve("pairing-qr.png");
    const notifier = new WhatsAppNotifier(config.whatsapp.authDir, config.whatsapp.targetNumber, {
      onQr: (qr) => {
        console.log("[cli] --- QR START ---");
        qrcodeTerminal.generate(qr, { small: true });
        console.log("[cli] --- QR END ---");
        QRCode.toFile(qrPngPath, qr, { width: 512 }, (err) => {
          if (err) {
            console.error("[cli] Failed to write QR code image:", err);
            return;
          }
          console.log(
            `[cli] QR code also written to ${qrPngPath} - scan within ~20s, it refreshes automatically if it expires.`,
          );
        });
      },
    });

    await notifier.send("✅ virtualx-apps-updater: WhatsApp-Pairing erfolgreich getestet.");
    console.log("[cli] Test message sent - pairing complete.");
    await notifier.close();
    // See the comment on the "run" command - Baileys' keep-alive timer
    // otherwise keeps this process alive indefinitely.
    process.exit(0);
  });

program.parseAsync(process.argv).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
