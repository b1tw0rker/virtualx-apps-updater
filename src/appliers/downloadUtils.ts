import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export async function downloadFile(url: string, destination: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination));
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(filePath), hash);
  return hash.digest("hex");
}

export function assertChecksum(label: string, expected: string, actual: string): void {
  if (actual !== expected) {
    throw new Error(`Checksum mismatch for ${label}: expected ${expected}, got ${actual}`);
  }
}

interface GithubReleaseAsset {
  name: string;
  digest?: string;
}

/**
 * Verifies archivePath against the sha256 digest GitHub publishes for a
 * named release asset (GitHub computes and exposes this itself - no
 * separate .sha256 file needed from the project).
 */
export async function verifyGithubReleaseChecksum(
  repo: string,
  tag: string,
  archiveName: string,
  archivePath: string,
): Promise<void> {
  const response = await fetch(`https://api.github.com/repos/${repo}/releases/tags/${tag}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "virtualx-apps-updater",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch release metadata for ${repo}@${tag}: ${response.status} ${response.statusText}`,
    );
  }

  const release = (await response.json()) as { assets: GithubReleaseAsset[] };
  const asset = release.assets.find((a) => a.name === archiveName);
  const digest = asset?.digest;
  if (!digest?.startsWith("sha256:")) {
    throw new Error(`No sha256 digest published by GitHub for ${archiveName} on release ${tag}`);
  }

  assertChecksum(archiveName, digest.slice("sha256:".length), await sha256File(archivePath));
}
