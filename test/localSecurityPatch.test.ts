import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { chown, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as tar from "tar";
import { applyLocalSecurityPatches } from "../src/localSecurityPatch.js";

const VERSION = "5.2.3";
const ARCHIVE_NAME = `phpMyAdmin-${VERSION}-all-languages.tar.gz`;
const ARCHIVE_URL = `https://files.phpmyadmin.net/phpMyAdmin/${VERSION}/${ARCHIVE_NAME}`;
const OWNER_UID = 1234;
const OWNER_GID = 1234;

describe("applyLocalSecurityPatches", () => {
  let workDir: string;
  let httpdDir: string;
  let backupsDir: string;
  let archivePath: string;
  let archiveHash: string;

  async function setupSite(
    domain: string,
    currentVersion: string,
  ): Promise<string> {
    const dbxPath = path.join(httpdDir, domain, "htdocs", "dbx");
    await mkdir(dbxPath, { recursive: true });
    await writeFile(path.join(dbxPath, ".virtualx.phpmyadmin"), `${currentVersion}\n`);
    await writeFile(path.join(dbxPath, "config.inc.php"), "CUSTOM_CONFIG");
    await writeFile(path.join(dbxPath, "OLD_FILE.txt"), "keep me");
    await chown(dbxPath, OWNER_UID, OWNER_GID);
    return dbxPath;
  }

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "local-patch-test-"));
    httpdDir = path.join(workDir, "httpd");
    backupsDir = path.join(workDir, "_backups");

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

  it("applies a same-major.minor patch, restores ownership and rewrites the marker", async () => {
    const dbxPath = await setupSite("www.testdomain.de", "5.2.1");

    const results = await applyLocalSecurityPatches({
      httpdDir,
      backupsDir,
      latestVersion: VERSION,
      dryRun: false,
    });

    expect(results).toEqual([
      {
        app: { folder: path.join("www.testdomain.de", "htdocs", "dbx"), name: "phpMyAdmin", enabled: true },
        previousVersion: "5.2.1",
        newVersion: VERSION,
      },
    ]);

    await expect(readFile(path.join(dbxPath, "config.inc.php"), "utf8")).resolves.toBe(
      "CUSTOM_CONFIG",
    );
    await expect(readFile(path.join(dbxPath, "NEW_FILE.txt"), "utf8")).resolves.toBe("brand new");
    expect(existsSync(path.join(dbxPath, "OLD_FILE.txt"))).toBe(true);
    await expect(readFile(path.join(dbxPath, ".virtualx.phpmyadmin"), "utf8")).resolves.toBe(
      `${VERSION}\n`,
    );

    const newFileStat = await stat(path.join(dbxPath, "NEW_FILE.txt"));
    expect(newFileStat.uid).toBe(OWNER_UID);
    expect(newFileStat.gid).toBe(OWNER_GID);
    const dirStat = await stat(dbxPath);
    expect(dirStat.uid).toBe(OWNER_UID);
    expect(dirStat.gid).toBe(OWNER_GID);

    const backupName = `${"www.testdomain.de-htdocs-dbx"}-5.2.1-backup-${todayStamp()}.tar.gz`;
    expect(existsSync(path.join(backupsDir, backupName))).toBe(true);
  });

  it("does not apply a minor/major version jump, only reports it", async () => {
    const dbxPath = await setupSite("www.testdomain.de", "5.1.0");

    const results = await applyLocalSecurityPatches({
      httpdDir,
      backupsDir,
      latestVersion: VERSION,
      dryRun: false,
    });

    expect(results).toEqual([]);
    expect(existsSync(path.join(dbxPath, "NEW_FILE.txt"))).toBe(false);
    await expect(readFile(path.join(dbxPath, ".virtualx.phpmyadmin"), "utf8")).resolves.toBe(
      "5.1.0\n",
    );
  });

  it("skips a site that is already up to date", async () => {
    const dbxPath = await setupSite("www.testdomain.de", VERSION);

    const results = await applyLocalSecurityPatches({
      httpdDir,
      backupsDir,
      latestVersion: VERSION,
      dryRun: false,
    });

    expect(results).toEqual([]);
    expect(existsSync(path.join(dbxPath, "NEW_FILE.txt"))).toBe(false);
  });

  it("skips a dbx folder that has no .virtualx.phpmyadmin marker", async () => {
    const dbxPath = path.join(httpdDir, "www.testdomain.de", "htdocs", "dbx");
    await mkdir(dbxPath, { recursive: true });
    await writeFile(path.join(dbxPath, "config.inc.php"), "CUSTOM_CONFIG");

    const results = await applyLocalSecurityPatches({
      httpdDir,
      backupsDir,
      latestVersion: VERSION,
      dryRun: false,
    });

    expect(results).toEqual([]);
    expect(existsSync(path.join(dbxPath, "NEW_FILE.txt"))).toBe(false);
  });

  it("does nothing when httpdDir does not contain any dbx folders", async () => {
    await mkdir(path.join(httpdDir, "www.testdomain.de", "htdocs"), { recursive: true });

    const results = await applyLocalSecurityPatches({
      httpdDir,
      backupsDir,
      latestVersion: VERSION,
      dryRun: false,
    });

    expect(results).toEqual([]);
  });

  it("dry run reports but does not change anything", async () => {
    const dbxPath = await setupSite("www.testdomain.de", "5.2.1");

    const results = await applyLocalSecurityPatches({
      httpdDir,
      backupsDir,
      latestVersion: VERSION,
      dryRun: true,
    });

    expect(results).toEqual([]);
    expect(existsSync(path.join(dbxPath, "NEW_FILE.txt"))).toBe(false);
    await expect(readFile(path.join(dbxPath, ".virtualx.phpmyadmin"), "utf8")).resolves.toBe(
      "5.2.1\n",
    );
  });
});

function todayStamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
}
