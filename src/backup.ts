import { mkdir } from "node:fs/promises";
import path from "node:path";
import * as tar from "tar";

function todayStamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
}

/**
 * Creates a `<folder>-<version>-backup-<YYYYMMDD>.tar.gz` archive of an app
 * folder into backupsDir, following the existing manual backup convention
 * already used under /var/virtualx/apps/_backups.
 */
export async function createBackup(
  appsDir: string,
  backupsDir: string,
  folder: string,
  version: string,
): Promise<string> {
  await mkdir(backupsDir, { recursive: true });

  const fileName = `${folder}-${version}-backup-${todayStamp()}.tar.gz`;
  const archivePath = path.join(backupsDir, fileName);

  await tar.create({ gzip: true, file: archivePath, cwd: appsDir }, [folder]);

  return archivePath;
}
