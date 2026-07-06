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
