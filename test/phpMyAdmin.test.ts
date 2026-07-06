import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as tar from "tar";
import { applyPhpMyAdminUpdate } from "../src/appliers/phpMyAdmin.js";
import type { AppEntry } from "../src/types.js";

const VERSION = "9.9.9";
const ARCHIVE_NAME = `phpMyAdmin-${VERSION}-all-languages.tar.gz`;
const ARCHIVE_URL = `https://files.phpmyadmin.net/phpMyAdmin/${VERSION}/${ARCHIVE_NAME}`;

const app: AppEntry = { folder: "_instances/dbx", name: "phpMyAdmin", enabled: true };

describe("applyPhpMyAdminUpdate", () => {
  let workDir: string;
  let appsDir: string;
  let archivePath: string;
  let archiveHash: string;

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "pma-test-"));
    appsDir = path.join(workDir, "apps");

    // Existing install with a custom config that must survive the update,
    // plus an unrelated file that a merge/overlay must not delete.
    await mkdir(path.join(appsDir, "_instances", "dbx"), { recursive: true });
    await writeFile(path.join(appsDir, "_instances", "dbx", "config.inc.php"), "CUSTOM_CONFIG");
    await writeFile(path.join(appsDir, "_instances", "dbx", "OLD_FILE.txt"), "keep me");

    // Build a fixture archive matching the real distribution layout.
    const fixtureRoot = path.join(workDir, "fixture");
    const topLevel = `phpMyAdmin-${VERSION}-all-languages`;
    await mkdir(path.join(fixtureRoot, topLevel), { recursive: true });
    await writeFile(path.join(fixtureRoot, topLevel, "config.inc.php"), "SAMPLE_CONFIG");
    await writeFile(path.join(fixtureRoot, topLevel, "NEW_FILE.txt"), "brand new");

    archivePath = path.join(workDir, ARCHIVE_NAME);
    await tar.create({ gzip: true, file: archivePath, cwd: fixtureRoot }, [topLevel]);

    const hash = createHash("sha256");
    for await (const chunk of createReadStream(archivePath)) hash.update(chunk);
    archiveHash = hash.digest("hex");

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === `${ARCHIVE_URL}.sha256`) {
          return new Response(`${archiveHash}  ${ARCHIVE_NAME}\n`, { status: 200 });
        }
        if (url === ARCHIVE_URL) {
          return new Response(Readable.toWeb(createReadStream(archivePath)) as ReadableStream, {
            status: 200,
          });
        }
        throw new Error(`Unexpected fetch call: ${url}`);
      }),
    );
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(workDir, { recursive: true, force: true });
  });

  it("overlays new files without touching an existing config.inc.php or unrelated files", async () => {
    await applyPhpMyAdminUpdate(app, appsDir, VERSION);

    await expect(
      readFile(path.join(appsDir, "_instances", "dbx", "config.inc.php"), "utf8"),
    ).resolves.toBe("CUSTOM_CONFIG");
    await expect(
      readFile(path.join(appsDir, "_instances", "dbx", "NEW_FILE.txt"), "utf8"),
    ).resolves.toBe("brand new");
    expect(existsSync(path.join(appsDir, "_instances", "dbx", "OLD_FILE.txt"))).toBe(true);
  });

  it("throws on checksum mismatch and leaves the target untouched", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === `${ARCHIVE_URL}.sha256`) {
          return new Response(`deadbeef  ${ARCHIVE_NAME}\n`, { status: 200 });
        }
        if (url === ARCHIVE_URL) {
          return new Response(Readable.toWeb(createReadStream(archivePath)) as ReadableStream, {
            status: 200,
          });
        }
        throw new Error(`Unexpected fetch call: ${url}`);
      }),
    );

    await expect(applyPhpMyAdminUpdate(app, appsDir, VERSION)).rejects.toThrow(
      /Checksum mismatch/,
    );
    await expect(
      readFile(path.join(appsDir, "_instances", "dbx", "config.inc.php"), "utf8"),
    ).resolves.toBe("CUSTOM_CONFIG");
    expect(existsSync(path.join(appsDir, "_instances", "dbx", "NEW_FILE.txt"))).toBe(false);
  });
});
