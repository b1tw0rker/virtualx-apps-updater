import semver from "semver";
import type { UpdateSource } from "../types.js";
import type { UpdateChecker } from "./UpdateChecker.js";

interface GithubTag {
  name: string;
}

const GITHUB_API = "https://api.github.com";
const PAGE_SIZE = 100;
// GitHub's tags API isn't guaranteed to be chronologically ordered (older
// repos mix "v1.2.3" and "1.2.3" tagging conventions from different eras),
// so a handful of pages isn't enough to reliably find the true latest tag
// once a repo has hundreds of tags (e.g. Roundcube has 400+). The loop below
// already stops early once a page comes back empty, so raising this cap
// doesn't cost extra requests for repos with fewer tags.
const MAX_PAGES = 10;

/**
 * Resolves the latest version of a GitHub-hosted project by matching tag names
 * against a regex with three numeric capture groups (major, minor, patch).
 * Example: phpMyAdmin tags look like "RELEASE_5_2_3" -> "5.2.3".
 */
export class GithubTagChecker implements UpdateChecker {
  constructor(private readonly source: Extract<UpdateSource, { type: "github-tag" }>) {}

  async getLatestVersion(): Promise<string | null> {
    const pattern = new RegExp(this.source.tagPattern);
    const versions: string[] = [];

    for (let page = 1; page <= MAX_PAGES; page++) {
      const tags = await this.fetchTagsPage(page);
      if (tags.length === 0) break;

      for (const tag of tags) {
        const match = tag.name.match(pattern);
        if (!match) continue;
        const version = `${match[1]}.${match[2]}.${match[3]}`;
        if (semver.valid(version)) versions.push(version);
      }
    }

    if (versions.length === 0) return null;
    return versions.sort(semver.rcompare)[0] ?? null;
  }

  private async fetchTagsPage(page: number): Promise<GithubTag[]> {
    const url = `${GITHUB_API}/repos/${this.source.repo}/tags?per_page=${PAGE_SIZE}&page=${page}`;
    const response = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "virtualx-apps-updater",
      },
    });

    if (!response.ok) {
      console.warn(
        `[GithubTagChecker] GitHub API request failed for ${this.source.repo}: ${response.status} ${response.statusText}`,
      );
      return [];
    }

    return (await response.json()) as GithubTag[];
  }
}
