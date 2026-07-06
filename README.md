# virtualx-apps-updater

Scans `/var/virtualx/apps`, checks whitelisted apps for updates, backs them
up, applies updates, sends a WhatsApp notification (via
[Baileys](https://github.com/WhiskeySockets/Baileys)) for every update, and
deploys the result to a target server.

Background and full requirements: [#1](https://github.com/b1tw0rker/virtualx-apps-updater/issues/1).

This repo lives directly inside `/var/virtualx/apps` on the control host
(dev001) — `package.json` at the repo root, code under `src/`, right next to
the managed app folders (`_instances/dbx/`, `_instances/mailx/`, ...). Two things keep that from
causing cross-contamination:

- `.gitignore` is whitelist-style: only this tool's own files are tracked,
  the app folders (and any added later) are never picked up by git.
- `deployToServer()` excludes this tool's own footprint (`node_modules/`,
  `.git/`, `src/`, `.env`, `.baileys_auth/`, etc.) from the rsync to srv010,
  so none of it ships to the deploy target.

`lint`/`test` are scoped to `src`/`test` explicitly for the same reason —
running them unscoped walks the entire multi-hundred-MB app tree.

## How it works

Each app folder under `APPS_DIR` is expected to carry a `.virtualx.<app>`
marker file holding its currently installed version (this convention already
existed in `/var/virtualx/apps` before this project). The tool:

1. **scan** — walks `APPS_DIR`, finds all `.virtualx.*` marker files, and
   merges newly discovered apps into `config/apps.json` (added disabled by
   default — nothing is auto-enabled).
2. **run** — for every `enabled: true` app with a `source` configured,
   checks the latest available version, creates a backup
   (`_backups/<folder>-<version>-backup-<date>.tar.gz`), applies the update,
   rewrites the marker file, and sends a WhatsApp message. If any app was
   updated, it then deploys `APPS_DIR` to the configured server and sends a
   deploy confirmation.
3. **deploy** — runs the deploy step on its own, independent of the update
   cycle.

## Status

- Update *detection* is implemented generically via GitHub tags
  (`src/checkers/GithubTagChecker.ts`) and wired up for phpMyAdmin and
  Roundcube.
- Update *application* is implemented for:
  - **phpMyAdmin** (`src/appliers/phpMyAdmin.ts`): downloads the official
    `-all-languages` distribution from files.phpmyadmin.net, verifies its
    published sha256 checksum, and overlays it onto `_instances/dbx/` without
    ever overwriting an existing `config.inc.php`.
  - **Roundcube** (`src/appliers/roundcube.ts`): downloads the official
    `-complete` distribution from the GitHub release, verifies it against
    the sha256 digest GitHub publishes for that asset, and overlays it onto
    `_instances/mailx/` without ever overwriting an existing
    `config/config.inc.php`.

  Both are a merge/overlay, not a mirror - files that aren't part of the new
  archive are left alone. Every other app still throws
  `NotImplementedError` from `src/appliers/applyUpdate.ts` until an applier
  is registered for it there.
- `_instances/dbx` (phpMyAdmin) and `_instances/mailx` (Roundcube) are
  enabled in `config/apps.json`. Every other
  discovered app is present but disabled — flip `enabled: true` and add a
  `source`/applier once they exist for that app.

## Setup

```bash
npm install
cp .env.example .env
# edit .env: set WHATSAPP_TARGET_NUMBER, DEPLOY_HOST/DEPLOY_SSH_KEY if needed
```

Discover apps and (re)write the whitelist:

```bash
npm run scan
```

Dry-run the update cycle (no backups, no changes, no WhatsApp/deploy):

```bash
npm run dev -- run --dry-run
```

Run for real:

```bash
npm run dev -- run
```

On the first real run, Baileys prints a QR code in the terminal — scan it
with WhatsApp (Linked devices) once. The session is then persisted in
`WHATSAPP_AUTH_DIR` (default `.baileys_auth/`, git-ignored) so subsequent
runs don't require re-pairing.

## Whitelist config (`config/apps.json`)

```json
{
  "apps": [
    {
      "folder": "_instances/dbx",
      "name": "phpMyAdmin",
      "enabled": true,
      "source": {
        "type": "github-tag",
        "repo": "phpmyadmin/phpmyadmin",
        "tagPattern": "RELEASE_(\\d+)_(\\d+)_(\\d+)$"
      }
    },
    { "folder": "_instances/mailx", "name": "Roundcube", "enabled": false }
  ]
}
```

Apps without a `source` are skipped during `run` even if `enabled: true`.

## Deploy

Deploying uses `rsync` over SSH (`root@192.168.0.10` by default, i.e. srv010
over the internal LAN). srv010's public hostname only offers GSSAPI auth for
root, not key-based SSH, so this only works from a control host on the same
internal network (dev001) - set `DEPLOY_HOST`/`DEPLOY_SSH_KEY` in `.env` if
running this from elsewhere. Verified end to end: a real `npm run deploy`
from dev001 synced all of `/var/virtualx/apps` (~725 MB) to srv010.

`deployToServer()` runs `rsync --delete`, so anything on the target that
doesn't exist locally gets removed - this mirrors dev001 onto srv010, it's
not a merge.

## Development

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

## Versioning

This project's own version lives in `package.json`. Running history is in
[`CHANGELOG.md`](./CHANGELOG.md), which also carries over the migrated
history from the old `version.pl`. Per-app installed versions are tracked in
each app's `.virtualx.<app>` marker file, not duplicated here.
