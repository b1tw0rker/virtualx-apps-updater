import "dotenv/config";
import path from "node:path";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  appsDir: required("APPS_DIR", "/var/virtualx/apps"),
  get backupsDir() {
    return path.join(this.appsDir, "_backups");
  },
  whitelistPath: required("WHITELIST_PATH", "config/apps.json"),
  // Root of locally hosted customer sites, scanned for per-domain dbx
  // (phpMyAdmin) copies when an app's `localSecurityPatches` flag is set.
  httpdDir: required("HTTPD_DIR", "/home/httpd"),

  whatsapp: {
    targetNumber: process.env.WHATSAPP_TARGET_NUMBER ?? "",
    authDir: required("WHATSAPP_AUTH_DIR", ".baileys_auth"),
  },

  deploy: {
    // srv010's public IP only offers GSSAPI auth for root; from
    // dev001 (the control host this runs on) it's reachable over the
    // internal LAN, where key-based SSH works.
    host: process.env.DEPLOY_HOST ?? "root@192.168.0.10",
    remotePath: process.env.DEPLOY_REMOTE_PATH ?? "/var/virtualx/apps",
    sshKeyPath: process.env.DEPLOY_SSH_KEY ?? undefined,
  },
};

export type AppConfig = typeof config;
