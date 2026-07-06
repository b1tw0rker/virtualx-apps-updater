export interface UpdateChecker {
  /** Returns the latest available version string (e.g. "5.2.4"), or null if it could not be determined. */
  getLatestVersion(): Promise<string | null>;
}
