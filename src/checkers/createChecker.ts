import type { UpdateSource } from "../types.js";
import { GithubTagChecker } from "./GithubTagChecker.js";
import type { UpdateChecker } from "./UpdateChecker.js";

export function createChecker(source: UpdateSource): UpdateChecker {
  switch (source.type) {
    case "github-tag":
      return new GithubTagChecker(source);
    default:
      throw new Error(`Unsupported update source type: ${(source as UpdateSource).type}`);
  }
}
