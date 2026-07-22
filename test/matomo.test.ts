import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZipFile } from "yazl";
import { applyMatomoUpdate } from "../src/appliers/matomo.js";
import type { AppEntry } from "../src/types.js";

const VERSION = "9.9.9";
const ARCHIVE_NAME = `matomo-${VERSION}.zip`;
const ARCHIVE_URL = `https://github.com/matomo-org/matomo/releases/download/${VERSION}/${ARCHIVE_NAME}`;
const RELEASE_API_URL = `https://api.github.com/repos/matomo-org/matomo/releases/tags/${VERSION}`;

const app: AppEntry = { folder: "_instances/matomo", name: "Matomo", enabled: true };

async function buildFixtureZip(destination: string): Promise<void> {
  const zip = new ZipFile();
  // Matomo's real release archive also has a stray file at the zip root
  // alongside the "matomo/" directory - the fixture reproduces that so the
  // "pick the directory, not just the first entry" logic is exercised.
  zip.addBuffer(Buffer.from("<html></html>"), "How to install Matomo.html");
  zip.addBuffer(Buffer.from("SAMPLE_CONFIG"), "matomo/config/global.ini.php");
  zip.addBuffer(Buffer.from("brand new"), "matomo/NEW_FILE.txt");
  zip.end();

  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(destination);
    zip.outputStream.pipe(out).on("close", resolve).on("error", reject);
    zip.outputStream.on("error", reject);
  });
}

describe("applyMatomoUpdate", () => {
  let workDir: string;
  let appsDir: string;
  let archivePath: string;
  let archiveHash: string;

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "matomo-test-"));
    appsDir = path.join(workDir, "apps");

    // Existing install with a real site config that must survive the update,
    // plus an unrelated file that a merge/overlay must not delete.
    await mkdir(path.join(appsDir, "_instances", "matomo", "config"), { recursive: true });
    await writeFile(
      path.join(appsDir, "_instances", "matomo", "config", "config.ini.php"),
      "CUSTOM_CONFIG",
    );
    await writeFile(path.join(appsDir, "_instances", "matomo", "OLD_FILE.txt"), "keep me");

    archivePath = path.join(workDir, ARCHIVE_NAME);
    await buildFixtureZip(archivePath);

    const hash = createHash("sha256");
    for await (const chunk of createReadStream(archivePath)) hash.update(chunk);
    archiveHash = hash.digest("hex");

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === RELEASE_API_URL) {
          return new Response(
            JSON.stringify({ assets: [{ name: ARCHIVE_NAME, digest: `sha256:${archiveHash}` }] }),
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

  it("overlays new files without touching an existing config/config.ini.php or unrelated files", async () => {
    await applyMatomoUpdate(app, appsDir, VERSION);

    await expect(
      readFile(path.join(appsDir, "_instances", "matomo", "config", "config.ini.php"), "utf8"),
    ).resolves.toBe("CUSTOM_CONFIG");
    await expect(
      readFile(path.join(appsDir, "_instances", "matomo", "NEW_FILE.txt"), "utf8"),
    ).resolves.toBe("brand new");
    expect(existsSync(path.join(appsDir, "_instances", "matomo", "OLD_FILE.txt"))).toBe(true);
  });

  it("throws when GitHub publishes no digest for the asset", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === RELEASE_API_URL) {
          return new Response(JSON.stringify({ assets: [{ name: ARCHIVE_NAME }] }), {
            status: 200,
          });
        }
        if (url === ARCHIVE_URL) {
          return new Response(Readable.toWeb(createReadStream(archivePath)) as ReadableStream, {
            status: 200,
          });
        }
        throw new Error(`Unexpected fetch call: ${url}`);
      }),
    );

    await expect(applyMatomoUpdate(app, appsDir, VERSION)).rejects.toThrow(/No sha256 digest/);
  });

  it("throws on checksum mismatch and leaves the target untouched", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === RELEASE_API_URL) {
          return new Response(
            JSON.stringify({ assets: [{ name: ARCHIVE_NAME, digest: "sha256:deadbeef" }] }),
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

    await expect(applyMatomoUpdate(app, appsDir, VERSION)).rejects.toThrow(/Checksum mismatch/);
    await expect(
      readFile(path.join(appsDir, "_instances", "matomo", "config", "config.ini.php"), "utf8"),
    ).resolves.toBe("CUSTOM_CONFIG");
    expect(existsSync(path.join(appsDir, "_instances", "matomo", "NEW_FILE.txt"))).toBe(false);
  });
});
