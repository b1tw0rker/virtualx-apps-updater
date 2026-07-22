# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`virtualx-apps-updater` scans `/var/virtualx/apps`, checks whitelisted apps
for updates, backs them up, applies updates, sends a WhatsApp notification
(via [Baileys](https://github.com/WhiskeySockets/Baileys)) for every update,
and deploys the result to a target server (srv010).

This repo lives *directly inside* `/var/virtualx/apps` on the control host
(dev001) — `package.json` at the repo root, code under `src/`, right next to
the managed app folders themselves (e.g. `_instances/dbx/`,
`_instances/mailx/`, `_archive/...`). This is why:

- `.gitignore` is whitelist-style (`/*` then explicit `!/...` allows) —
  only this tool's own files are tracked; the app folders are never picked
  up by git, no matter what gets added under them later.
- `deployToServer()` (`src/deploy.ts`) hardcodes an exclude list
  (`node_modules/`, `.git/`, `src/`, `config/`, `.env`, `.baileys_auth/`,
  etc.) so none of this tool's own footprint ships to the rsync deploy
  target.
- `lint`/`test` are scoped to `src`/`test` explicitly — running them
  unscoped would walk the entire multi-hundred-MB app tree.

## Commands

```bash
npm install
cp .env.example .env        # set WHATSAPP_TARGET_NUMBER, DEPLOY_HOST/DEPLOY_SSH_KEY as needed

npm run typecheck            # tsc --noEmit
npm run lint                 # eslint src test
npm test                     # vitest run --dir test
npm run build                # tsc -p tsconfig.json -> dist/

npm run dev -- scan                    # discover apps, (re)write config/apps.json
npm run dev -- run --dry-run           # report available updates, no changes/deploy
npm run dev -- run                     # full update cycle: check, backup, apply, notify, deploy
npm run dev -- deploy                  # rsync APPS_DIR to the deploy target, independent of run
npm run dev -- pair                    # pair the WhatsApp session (QR code)
```

Run a single test file: `npx vitest run test/phpMyAdmin.test.ts`
Run a single test by name: `npx vitest run test/phpMyAdmin.test.ts -t "checksum mismatch"`

## Architecture

The update cycle (`src/orchestrator.ts::runUpdateCycle`) wires the pieces
together in this order, and is the best place to start reading:

1. **Scan** (`src/scanner.ts`) — walks `APPS_DIR` for immediate
   subdirectories containing a `.virtualx.<appKey>` marker file (the
   pre-existing convention in `/var/virtualx/apps`), plus one level inside
   `_instances/` (where newly onboarded apps are placed — see below).
   Folders without a marker (`_backups`, `sql`, ...) aren't apps.
2. **Whitelist** (`src/whitelist.ts`) — merges freshly scanned apps into
   `config/apps.json` (`AppEntry[]`: `folder`, `name`, `enabled`, optional
   `source`). Newly discovered apps are added **disabled** by default and
   without a `source`; existing entries' `enabled`/`source` are never
   touched by a rescan. `KNOWN_SOURCES`/`FRIENDLY_NAMES` map an `appKey`
   (from the marker filename) to a default update source / display name
   the first time an app is seen.
3. **Check** (`src/checkers/`) — for each `enabled` app with a `source`,
   `createChecker()` builds an `UpdateChecker` (currently only
   `GithubTagChecker`, matching `source.tagPattern` against GitHub release
   tags) and compares the result against the app's current version (from
   its marker file, `semver.coerce`d since not all markers are strict
   semver — e.g. TYPO3's is just `"11"`).
4. **Backup** (`src/backup.ts`) — tars `appsDir/<folder>` into
   `_backups/<folder-with-slashes-flattened>-<version>-backup-<YYYYMMDD>.tar.gz`
   *before* applying anything.
5. **Apply** (`src/appliers/applyUpdate.ts`) — dispatches on `app.folder` to
   a per-app `Applier` (`(app, appsDir, newVersion) => Promise<void>`)
   registered in the `APPLIERS` map. Apps without an entry throw
   `NotImplementedError` — this is caught by the orchestrator (backup still
   happens, nothing else does) rather than being a hard failure, since
   detection/backup/notification is meant to work for every app even
   before an applier exists for it. Appliers so far
   (`src/appliers/phpMyAdmin.ts`, `src/appliers/roundcube.ts`) download the
   official release archive, verify its published sha256 checksum
   (`src/appliers/downloadUtils.ts`), and **overlay** (not mirror) it onto
   `appsDir/app.folder` — local config files (`config.inc.php`,
   `config/config.inc.php`) are never overwritten if already present, and
   files outside the new archive are left untouched.
6. **Marker rewrite** (`src/marker.ts`) — on success, overwrites the
   `.virtualx.<appKey>` file with the new version so the on-disk convention
   stays authoritative.
7. **Notify** (`src/notify/`) — `Notifier` interface, implemented by
   `WhatsAppNotifier` (Baileys). One WhatsApp message per successful
   update, plus one deploy-confirmation message if anything was deployed.
8. **Deploy** (`src/deploy.ts`) — if any app was updated (and not a dry
   run), rsyncs all of `APPS_DIR` to the deploy target with `--delete`
   (mirrors dev001 onto srv010; excludes this tool's own files per
   `SELF_EXCLUDES`).

**The `_instances/` migration**: apps used to live as plain top-level
folders directly under `APPS_DIR` (e.g. what is now `_instances/dbx`,
`_instances/mailx` used to be `dbx`, `mailx`). New apps are onboarded
directly under `_instances/`; existing top-level apps are migrated in over
time. `scanApps()` looks in both places. Whenever an app folder is
physically moved, its `folder` value has to be updated consistently across
`config/apps.json`, the `APPLIERS` map key in
`src/appliers/applyUpdate.ts`, any hardcoded path in that app's applier
(appliers must use `app.folder`, not a literal folder name), and
`INITIAL_ENABLED_FOLDERS` in `src/whitelist.ts` if that app was in there —
otherwise a fresh scan silently stops auto-enabling it at its new location.

**Config** (`src/config.ts`) reads everything from env vars (via
`dotenv/config`), with defaults matching this specific deployment
(`APPS_DIR=/var/virtualx/apps`, `DEPLOY_HOST=root@192.168.0.10` i.e. srv010
over the internal LAN — srv010's public hostname only offers GSSAPI auth
for root, so deploy only works from a control host on the same internal
network, dev001).

**CLI** (`src/index.ts`, via `commander`): `scan`, `run [--dry-run]`,
`deploy`, `pair` (writes a scannable QR to `pairing-qr.png` and sends a test
WhatsApp message once paired). Both `run` and `pair` call `process.exit(0)`
explicitly at the end — Baileys keeps an internal keep-alive timer running
after the socket closes, which would otherwise hang the process forever
once a message has been sent (fatal for a cron-triggered `run`).

## Adding a new app applier

Register a new function matching the `Applier` type in the `APPLIERS` map
in `src/appliers/applyUpdate.ts`, keyed by that app's `folder` value. Follow
the existing `phpMyAdmin.ts`/`roundcube.ts` pattern: download the official
release archive, verify its checksum, and `cp` with a `filter` that skips
overwriting the site's local config file(s) if they already exist — this is
a merge/overlay, never a mirror/delete.

Not every app fits the download/overlay mold. `src/appliers/flarum.ts` is the
exception: Flarum publishes no self-contained archive (its GitHub releases
carry only the source zipball, no `vendor/`) and is upgraded exclusively via
Composer. Its applier therefore shells out to `composer update` + `php flarum
migrate` + `php flarum cache:clear` **in place** in `appsDir/app.folder` — no
download, no overlay, no config-guard filter (in-place upgrade preserves
`config.php`, `storage/`, and installed extensions inherently). It needs
`composer`/`php` on the control host, and only advances within the site's own
`composer.json` constraint, so a new *major* release is intentionally not
pulled automatically (same major-version caveat as the TYPO3/Nextcloud
checkers). Flarum's checker/whitelist entry are wired up but the app ships
`enabled: false` in `config/apps.json` until an instance actually exists under
`_instances/flarum` (it is not installed yet).

## Versioning

This project's own version lives in `package.json`. Running history is in
`CHANGELOG.md` (Keep a Changelog format), which also carries over migrated
history from the old `version.pl`. Per-app installed versions are tracked
in each app's `.virtualx.<app>` marker file, not duplicated in the
changelog.
