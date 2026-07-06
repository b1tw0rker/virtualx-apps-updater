import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AppEntry, ScannedApp, UpdateSource, WhitelistConfig } from "./types.js";

const FRIENDLY_NAMES: Record<string, string> = {
  phpmyadmin: "phpMyAdmin",
  roundcube: "Roundcube",
  magento24: "Magento",
  opencart: "OpenCart",
  phpbb3: "phpBB3",
  typo3: "TYPO3",
};

// Known update sources for apps we already know how to check via GitHub tags.
// Apps without an entry here are scanned/whitelisted but skipped during update checks
// until a checker is configured for them.
const KNOWN_SOURCES: Record<string, UpdateSource> = {
  phpmyadmin: {
    type: "github-tag",
    repo: "phpmyadmin/phpmyadmin",
    tagPattern: "RELEASE_(\\d+)_(\\d+)_(\\d+)$",
  },
};

// Only phpMyAdmin (folder "dbx") is enabled by default, per the initial rollout plan.
const INITIAL_ENABLED_FOLDERS = new Set(["dbx"]);

function friendlyName(appKey: string): string {
  return FRIENDLY_NAMES[appKey] ?? appKey;
}

function toAppEntry(scanned: ScannedApp): AppEntry {
  return {
    folder: scanned.folder,
    name: friendlyName(scanned.appKey),
    enabled: INITIAL_ENABLED_FOLDERS.has(scanned.folder),
    source: KNOWN_SOURCES[scanned.appKey],
  };
}

/**
 * Loads config/apps.json if present and merges in any newly discovered apps
 * (added as disabled) without touching existing entries' `enabled`/`source`
 * fields. Writes the merged result back to disk and returns it.
 */
export async function loadOrInitWhitelist(
  whitelistPath: string,
  scannedApps: ScannedApp[],
): Promise<AppEntry[]> {
  const existing = await readExisting(whitelistPath);
  const byFolder = new Map(existing.map((app) => [app.folder, app]));

  for (const scanned of scannedApps) {
    if (!byFolder.has(scanned.folder)) {
      byFolder.set(scanned.folder, toAppEntry(scanned));
    }
  }

  const merged = Array.from(byFolder.values());
  await persist(whitelistPath, merged);
  return merged;
}

async function readExisting(whitelistPath: string): Promise<AppEntry[]> {
  try {
    const raw = await readFile(whitelistPath, "utf8");
    const parsed = JSON.parse(raw) as WhitelistConfig;
    return parsed.apps ?? [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function persist(whitelistPath: string, apps: AppEntry[]): Promise<void> {
  await mkdir(path.dirname(whitelistPath), { recursive: true });
  const payload: WhitelistConfig = { apps };
  await writeFile(whitelistPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}
