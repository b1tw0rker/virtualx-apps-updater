import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as tar from "tar";
import { applyRoundcubeUpdate } from "../src/appliers/roundcube.js";
import type { AppEntry } from "../src/types.js";

const VERSION = "9.9.9";
const ARCHIVE_NAME = `roundcubemail-${VERSION}-complete.tar.gz`;
const ARCHIVE_URL = `https://github.com/roundcube/roundcubemail/releases/download/${VERSION}/${ARCHIVE_NAME}`;
const RELEASE_API_URL = `https://api.github.com/repos/roundcube/roundcubemail/releases/tags/${VERSION}`;

const app: AppEntry = { folder: "mailx", name: "Roundcube", enabled: true };

describe("applyRoundcubeUpdate", () => {
  let workDir: string;
  let appsDir: string;
  let archivePath: string;
  let archiveHash: string;

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "rc-test-"));
    appsDir = path.join(workDir, "apps");

    // Existing install with a real config that must survive the update,
    // plus an unrelated file that a merge/overlay must not delete.
    await mkdir(path.join(appsDir, "mailx", "config"), { recursive: true });
    await writeFile(
      path.join(appsDir, "mailx", "config", "config.inc.php"),
      "CUSTOM_CONFIG",
    );
    await writeFile(path.join(appsDir, "mailx", "OLD_FILE.txt"), "keep me");

    const fixtureRoot = path.join(workDir, "fixture");
    const topLevel = `roundcubemail-${VERSION}`;
    await mkdir(path.join(fixtureRoot, topLevel, "config"), { recursive: true });
    await writeFile(
      path.join(fixtureRoot, topLevel, "config", "config.inc.php.sample"),
      "SAMPLE_CONFIG",
    );
    await writeFile(path.join(fixtureRoot, topLevel, "NEW_FILE.txt"), "brand new");

    archivePath = path.join(workDir, ARCHIVE_NAME);
    await tar.create({ gzip: true, file: archivePath, cwd: fixtureRoot }, [topLevel]);

    const hash = createHash("sha256");
    for await (const chunk of createReadStream(archivePath)) hash.update(chunk);
    archiveHash = hash.digest("hex");

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === RELEASE_API_URL) {
          return new Response(
            JSON.stringify({
              assets: [{ name: ARCHIVE_NAME, digest: `sha256:${archiveHash}` }],
            }),
            { status: 200 },
          );
        }
        if (url === ARCHIVE_URL) {
          const { Readable } = await import("node:stream");
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

  it("overlays new files without touching an existing config/config.inc.php or unrelated files", async () => {
    await applyRoundcubeUpdate(app, appsDir, VERSION);

    await expect(
      readFile(path.join(appsDir, "mailx", "config", "config.inc.php"), "utf8"),
    ).resolves.toBe("CUSTOM_CONFIG");
    await expect(readFile(path.join(appsDir, "mailx", "NEW_FILE.txt"), "utf8")).resolves.toBe(
      "brand new",
    );
    expect(existsSync(path.join(appsDir, "mailx", "OLD_FILE.txt"))).toBe(true);
    expect(
      existsSync(path.join(appsDir, "mailx", "config", "config.inc.php.sample")),
    ).toBe(true);
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
          const { Readable } = await import("node:stream");
          return new Response(Readable.toWeb(createReadStream(archivePath)) as ReadableStream, {
            status: 200,
          });
        }
        throw new Error(`Unexpected fetch call: ${url}`);
      }),
    );

    await expect(applyRoundcubeUpdate(app, appsDir, VERSION)).rejects.toThrow(
      /No sha256 digest/,
    );
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
          const { Readable } = await import("node:stream");
          return new Response(Readable.toWeb(createReadStream(archivePath)) as ReadableStream, {
            status: 200,
          });
        }
        throw new Error(`Unexpected fetch call: ${url}`);
      }),
    );

    await expect(applyRoundcubeUpdate(app, appsDir, VERSION)).rejects.toThrow(
      /Checksum mismatch/,
    );
    expect(existsSync(path.join(appsDir, "mailx", "NEW_FILE.txt"))).toBe(false);
  });
});
