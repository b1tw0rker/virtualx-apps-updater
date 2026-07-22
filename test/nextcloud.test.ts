import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZipFile } from "yazl";
import { applyNextcloudUpdate } from "../src/appliers/nextcloud.js";
import type { AppEntry } from "../src/types.js";

const VERSION = "9.9.9";
const ARCHIVE_NAME = `nextcloud-${VERSION}.zip`;
const ARCHIVE_URL = `https://download.nextcloud.com/server/releases/${ARCHIVE_NAME}`;

const app: AppEntry = { folder: "_instances/nextcloud", name: "Nextcloud", enabled: true };

async function buildFixtureZip(destination: string): Promise<void> {
  const zip = new ZipFile();
  zip.addBuffer(Buffer.from("SAMPLE_CONFIG"), "nextcloud/config/config.sample.php");
  zip.addBuffer(Buffer.from("brand new"), "nextcloud/NEW_FILE.txt");
  zip.end();

  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(destination);
    zip.outputStream.pipe(out).on("close", resolve).on("error", reject);
    zip.outputStream.on("error", reject);
  });
}

describe("applyNextcloudUpdate", () => {
  let workDir: string;
  let appsDir: string;
  let archivePath: string;
  let archiveHash: string;

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "nextcloud-test-"));
    appsDir = path.join(workDir, "apps");

    // Existing install with a real site config that must survive the update,
    // plus an unrelated file that a merge/overlay must not delete.
    await mkdir(path.join(appsDir, "_instances", "nextcloud", "config"), { recursive: true });
    await writeFile(
      path.join(appsDir, "_instances", "nextcloud", "config", "config.php"),
      "CUSTOM_CONFIG",
    );
    await writeFile(
      path.join(appsDir, "_instances", "nextcloud", "OLD_FILE.txt"),
      "keep me",
    );

    archivePath = path.join(workDir, ARCHIVE_NAME);
    await buildFixtureZip(archivePath);

    const hash = createHash("sha256");
    for await (const chunk of createReadStream(archivePath)) hash.update(chunk);
    archiveHash = hash.digest("hex");

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === `${ARCHIVE_URL}.sha256`) {
          // Real Nextcloud .sha256 files list both the .zip and .metadata
          // checksums on separate lines - the matching line must be picked
          // out by filename, not just taken as the first line.
          return new Response(
            `deadbeef  nextcloud-${VERSION}.metadata\n${archiveHash}  ${ARCHIVE_NAME}\n`,
            { status: 200 },
          );
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

  it("overlays new files without touching an existing config/config.php or unrelated files", async () => {
    await applyNextcloudUpdate(app, appsDir, VERSION);

    await expect(
      readFile(path.join(appsDir, "_instances", "nextcloud", "config", "config.php"), "utf8"),
    ).resolves.toBe("CUSTOM_CONFIG");
    await expect(
      readFile(path.join(appsDir, "_instances", "nextcloud", "NEW_FILE.txt"), "utf8"),
    ).resolves.toBe("brand new");
    expect(existsSync(path.join(appsDir, "_instances", "nextcloud", "OLD_FILE.txt"))).toBe(true);
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

    await expect(applyNextcloudUpdate(app, appsDir, VERSION)).rejects.toThrow(/Checksum mismatch/);
    await expect(
      readFile(path.join(appsDir, "_instances", "nextcloud", "config", "config.php"), "utf8"),
    ).resolves.toBe("CUSTOM_CONFIG");
    expect(existsSync(path.join(appsDir, "_instances", "nextcloud", "NEW_FILE.txt"))).toBe(false);
  });
});
