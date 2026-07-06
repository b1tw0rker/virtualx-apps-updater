import { spawn } from "node:child_process";

export interface DeployOptions {
  localPath: string;
  host: string;
  remotePath: string;
  sshKeyPath?: string;
}

// This tool's own files live directly inside APPS_DIR (see README) - none of
// them are part of the sites being managed, and some (.env, .baileys_auth)
// are secrets, so they must never be shipped to the deploy target.
const SELF_EXCLUDES = [
  "node_modules/",
  "dist/",
  "src/",
  "test/",
  "config/",
  ".git/",
  ".github/",
  ".baileys_auth/",
  ".env",
  ".env.example",
  ".gitignore",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "eslint.config.js",
  "README.md",
  "CHANGELOG.md",
  "LICENSE",
  "pairing-qr.png",
  "*.log",
];

/**
 * Mirrors localPath to host:remotePath via rsync over SSH. Requires `rsync`
 * and key-based SSH access to `host` to be available on the machine running
 * this tool.
 */
export function deployToServer(options: DeployOptions): Promise<void> {
  const sshCommand = options.sshKeyPath
    ? `ssh -i ${options.sshKeyPath} -o BatchMode=yes`
    : "ssh -o BatchMode=yes";

  const args = [
    "-avz",
    "--delete",
    ...SELF_EXCLUDES.flatMap((pattern) => ["--exclude", pattern]),
    "-e",
    sshCommand,
    `${options.localPath.replace(/\/?$/, "/")}`,
    `${options.host}:${options.remotePath}`,
  ];

  return new Promise((resolve, reject) => {
    const rsync = spawn("rsync", args, { stdio: "inherit" });

    rsync.on("error", reject);
    rsync.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`rsync exited with code ${code}`));
      }
    });
  });
}
