import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppEntry } from "../src/types.js";

// Flarum has no downloadable release archive - it is upgraded in place through
// Composer/PHP - so, unlike the overlay appliers, this test mocks the shelled-out
// commands (node:child_process execFile) rather than stubbing fetch.
const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn() }));

vi.mock("node:child_process", () => ({ execFile: execFileMock }));

const { applyFlarumUpdate } = await import("../src/appliers/flarum.js");

const VERSION = "9.9.9";
const APPS_DIR = "/srv/apps";
const app: AppEntry = { folder: "_instances/flarum", name: "Flarum", enabled: true };

// execFile is consumed via promisify(), so the mock must honour the Node
// callback convention: (cmd, args, opts, cb) => cb(err, { stdout, stderr }).
function succeed() {
  execFileMock.mockImplementation(
    (
      _cmd: string,
      _args: string[],
      _opts: unknown,
      cb: (err: unknown, result: { stdout: string; stderr: string }) => void,
    ) => cb(null, { stdout: "", stderr: "" }),
  );
}

describe("applyFlarumUpdate", () => {
  beforeEach(() => {
    execFileMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("runs composer update, then flarum migrate and cache:clear in the app folder", async () => {
    succeed();

    await applyFlarumUpdate(app, APPS_DIR, VERSION);

    const cwd = path.join(APPS_DIR, app.folder);
    expect(execFileMock).toHaveBeenCalledTimes(3);

    const calls = execFileMock.mock.calls;
    expect(calls[0]?.slice(0, 3)).toEqual([
      "composer",
      ["update", "--no-dev", "--optimize-autoloader", "--no-interaction"],
      { cwd },
    ]);
    expect(calls[1]?.slice(0, 3)).toEqual(["php", ["flarum", "migrate", "--no-interaction"], { cwd }]);
    expect(calls[2]?.slice(0, 3)).toEqual(["php", ["flarum", "cache:clear"], { cwd }]);
  });

  it("fails and does not migrate when composer update fails", async () => {
    execFileMock.mockImplementation(
      (
        cmd: string,
        _args: string[],
        _opts: unknown,
        cb: (err: unknown, result?: { stdout: string; stderr: string }) => void,
      ) => {
        if (cmd === "composer") return cb(new Error("composer update failed"));
        return cb(null, { stdout: "", stderr: "" });
      },
    );

    await expect(applyFlarumUpdate(app, APPS_DIR, VERSION)).rejects.toThrow(/composer update failed/);
    expect(execFileMock).toHaveBeenCalledTimes(1);
    expect(execFileMock.mock.calls[0]?.[0]).toBe("composer");
  });
});
