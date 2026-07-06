# virtualx-apps-updater

Scans `/var/virtualx/apps`, checks whitelisted apps for updates, backs them
up, applies updates, sends a WhatsApp notification (via
[Baileys](https://github.com/WhiskeySockets/Baileys)) for every update, and
deploys the result to a target server.

Background and full requirements: [#1](https://github.com/b1tw0rker/virtualx-apps-updater/issues/1).

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
  (`src/checkers/GithubTagChecker.ts`) and wired up for phpMyAdmin.
- Update *application* (actually downloading and installing a new version)
  is **not implemented yet** for any app — `src/appliers/applyUpdate.ts`
  intentionally throws `NotImplementedError` until a per-app updater is
  registered there. Detection, backup, and notification already run end to
  end; only the file-replacement step is a deliberate follow-up, since it's
  the riskiest part to get right per CMS.
- Only `dbx` (phpMyAdmin) is enabled in `config/apps.json`. Every other
  discovered app is present but disabled — flip `enabled: true` and add a
  `source` once its checker/applier exists.

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
      "folder": "dbx",
      "name": "phpMyAdmin",
      "enabled": true,
      "source": {
        "type": "github-tag",
        "repo": "phpmyadmin/phpmyadmin",
        "tagPattern": "RELEASE_(\\d+)_(\\d+)_(\\d+)$"
      }
    },
    { "folder": "mailx", "name": "Roundcube", "enabled": false }
  ]
}
```

Apps without a `source` are skipped during `run` even if `enabled: true`.

## Deploy

Deploying uses `rsync` over SSH (`root@srv010` by default). The
host running this tool needs `rsync` installed and key-based SSH access to
the target — set `DEPLOY_SSH_KEY` in `.env` if not using the default
identity/agent.

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
