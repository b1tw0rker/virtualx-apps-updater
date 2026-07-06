import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GithubTagChecker } from "../src/checkers/GithubTagChecker.js";
import type { UpdateSource } from "../src/types.js";

const source: Extract<UpdateSource, { type: "github-tag" }> = {
  type: "github-tag",
  repo: "phpmyadmin/phpmyadmin",
  tagPattern: "RELEASE_(\\d+)_(\\d+)_(\\d+)$",
};

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    statusText: ok ? "OK" : "Internal Server Error",
    json: async () => body,
  } as Response;
}

describe("GithubTagChecker", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("picks the highest semver version among matching tags", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse([
          { name: "RELEASE_5_2_3" },
          { name: "RELEASE_5_2_4" },
          { name: "not-a-version-tag" },
          { name: "RELEASE_5_1_9" },
        ]),
      )
      .mockResolvedValueOnce(jsonResponse([]));

    const checker = new GithubTagChecker(source);
    await expect(checker.getLatestVersion()).resolves.toBe("5.2.4");
  });

  it("returns null when no tag matches the pattern", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse([{ name: "unrelated" }]));

    const checker = new GithubTagChecker(source);
    await expect(checker.getLatestVersion()).resolves.toBeNull();
  });

  it("returns null when the GitHub API request fails", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse([], false));

    const checker = new GithubTagChecker(source);
    await expect(checker.getLatestVersion()).resolves.toBeNull();
  });
});
