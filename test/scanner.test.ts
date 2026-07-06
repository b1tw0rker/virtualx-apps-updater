import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanApps } from "../src/scanner.js";

describe("scanApps", () => {
  let appsDir: string;

  beforeEach(async () => {
    appsDir = await mkdtemp(path.join(tmpdir(), "virtualx-apps-"));

    await mkdir(path.join(appsDir, "dbx"));
    await writeFile(path.join(appsDir, "dbx", ".virtualx.phpmyadmin"), "5.2.3\n");

    await mkdir(path.join(appsDir, "mailx"));
    await writeFile(path.join(appsDir, "mailx", ".virtualx.roundcube"), "1.7.2\n");

    // Folders without a marker file are not apps.
    await mkdir(path.join(appsDir, "_backups"));
    await mkdir(path.join(appsDir, "sql"));
  });

  afterEach(async () => {
    await rm(appsDir, { recursive: true, force: true });
  });

  it("finds only folders with a .virtualx.* marker file", async () => {
    const result = await scanApps(appsDir);
    const folders = result.map((app) => app.folder).sort();
    expect(folders).toEqual(["dbx", "mailx"]);
  });

  it("extracts appKey and version from the marker file", async () => {
    const result = await scanApps(appsDir);
    const dbx = result.find((app) => app.folder === "dbx");
    expect(dbx).toEqual({
      folder: "dbx",
      markerFile: ".virtualx.phpmyadmin",
      appKey: "phpmyadmin",
      version: "5.2.3",
    });
  });

  it("returns null version for an empty marker file", async () => {
    await mkdir(path.join(appsDir, "typo3"));
    await writeFile(path.join(appsDir, "typo3", ".virtualx.typo3"), "");

    const result = await scanApps(appsDir);
    const typo3 = result.find((app) => app.folder === "typo3");
    expect(typo3?.version).toBeNull();
  });

  it("also finds apps one level inside _instances/", async () => {
    await mkdir(path.join(appsDir, "_instances", "typo3"), { recursive: true });
    await writeFile(path.join(appsDir, "_instances", "typo3", ".virtualx.typo3"), "11\n");

    const result = await scanApps(appsDir);
    const typo3 = result.find((app) => app.folder === "_instances/typo3");
    expect(typo3).toEqual({
      folder: "_instances/typo3",
      markerFile: ".virtualx.typo3",
      appKey: "typo3",
      version: "11",
    });
  });

  it("does not treat _instances itself as an app when it has no marker", async () => {
    await mkdir(path.join(appsDir, "_instances"));

    const result = await scanApps(appsDir);
    expect(result.some((app) => app.folder === "_instances")).toBe(false);
  });
});
