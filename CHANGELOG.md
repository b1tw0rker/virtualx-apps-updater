# Changelog

All notable changes to this project are documented here, following the
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

## [Unreleased]

### Added

- Initial project scaffold: scanner, whitelist config (`config/apps.json`),
  GitHub-tag based update checker, backup step, Baileys WhatsApp notifier,
  rsync deploy step and a CLI (`scan` / `run` / `deploy`).
- Whitelist bootstrapped with only `_instances/dbx` (phpMyAdmin) enabled; all
  other discovered apps are added disabled by default.
- phpMyAdmin update applier: downloads the official `-all-languages`
  distribution, verifies its sha256 checksum, and overlays it onto
  `_instances/dbx/` while preserving the existing `config.inc.php`.
- Local security patches (`src/localSecurityPatch.ts`): an app entry with
  `"localSecurityPatches": true` (enabled for `dbx`/phpMyAdmin as a first
  case) additionally scans `HTTPD_DIR/<domain>/htdocs/dbx` for locally
  hosted customer copies of that app and patches any that are behind by a
  same-major.minor version only - minor/major jumps are reported, not
  applied. Backs up and restores original file ownership the same way the
  main `APPS_DIR` appliers do, independently of the `APPS_DIR` deploy step.

### Changed

- Replaced `version.pl` as the source of truth for versions/changelog. Per-app
  versions continue to live in each app folder's `.virtualx.<app>` marker
  file; the tool's own version now lives in `package.json`, and the running
  history moves here.
- Moved the Roundcube instance from `mailx/` to `_instances/mailx/` and
  updated all `mailx` references (`config/apps.json`, applier, tests)
  accordingly.
- Moved the phpMyAdmin instance from `dbx/` to `_instances/dbx/` and updated
  all `dbx` references (`config/apps.json`, applier, whitelist defaults,
  tests) accordingly.

---

## History migrated from `version.pl`

The entries below are carried over from the free-text changelog that used to
live as comments in `/var/virtualx/apps/version.pl`, for reference.

- 2026-07-06 — Updated Roundcube to version 1.7.2
- 2024-10-05 — Updated apps to current_version; renamed folder `webservice` to `apps`
- 2024-10-03/04 — Updated WordPress to 6.6.2
- 2022-07-28 — Renamed `mailapp` to `mailx`
- 2022-07-18 — Updated phpMyAdmin to version 5.2.0
- 2022-02-27 — Updated phpBB3 to version 3.3.5
- 2022-02-27 — Updated Roundcube to version 1.5.2
- 2022-02-26 — Updated phpMyAdmin to version 5.1.3
- 2022-01-30 — Updated WordPress to version 5.9
- 2022-01-29 — Security solution for OpenCart backend
- (undated, ~early 2022) — Updated phpMyAdmin to 5.1.2
- 2021-08-30 — Updated WordPress to version 5.8
- (undated) — Removed Tailwind and Bootstrap 5-beta
- (undated) — Updated Bootstrap to 5.1.0
- (undated) — Updated phpMyAdmin to 5.1.1
- 2021-07-17 — Updated ownCloud to 10.7
- 2021-06-25 — Updated to Bootstrap 5.0.2; updated Roundcube to version 1.5-beta
- (undated) — Changed checkfiles to `.virtualx.<program>` convention; updated ownCloud to 10.6
- 2021-02-05 — Removed osCommerce
- 2021-02-05 — Added Magento 2.4.1; removed Magento 1.9
- 2021-01-30 — Added WooCommerce
- 2021-01-27 — Added OpenCart
- 2021-01-15 — Added jQuery 3 and Bootstrap 5-beta1; removed MooTools and Dojo; updated WordPress to 5.6
- 2020-10-08 — Updated WordPress to 5.5.1
- 2020-08-03 — Removed Joomla, Drupal, Magento 1.8, auction system, Prototype, script.aculo.us
