export interface UpdateSource {
  /** Currently the only supported checker: compares against GitHub release/tag names. */
  type: "github-tag";
  /** e.g. "phpmyadmin/phpmyadmin" */
  repo: string;
  /** Regex with capture groups (major, minor, patch) matched against tag names, e.g. /RELEASE_(\d+)_(\d+)_(\d+)/ */
  tagPattern: string;
}

export interface AppEntry {
  /** Folder name directly under APPS_DIR, e.g. "dbx" */
  folder: string;
  /** Human readable name, e.g. "phpMyAdmin" */
  name: string;
  /** Whether this app may be checked/updated automatically. */
  enabled: boolean;
  /** Optional update source config; apps without one are skipped even if enabled. */
  source?: UpdateSource;
  /**
   * If true, also scans `<HTTPD_DIR>/<domain>/htdocs/dbx` for local phpMyAdmin
   * copies and patches them - but only when the latest available version is a
   * same-major.minor patch bump over the installed one (see
   * src/localSecurityPatch.ts). Minor/major jumps are reported, not applied.
   */
  localSecurityPatches?: boolean;
}

export interface WhitelistConfig {
  apps: AppEntry[];
}

export interface ScannedApp {
  folder: string;
  /** Name of the .virtualx.<appKey> marker file found in the folder. */
  markerFile: string;
  /** The <appKey> part of the marker file name, e.g. "phpmyadmin". */
  appKey: string;
  /** Version string contained in the marker file, if any. */
  version: string | null;
}

export interface UpdateResult {
  app: AppEntry;
  previousVersion: string | null;
  newVersion: string;
}
