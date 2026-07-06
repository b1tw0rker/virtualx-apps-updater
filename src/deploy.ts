import { spawn } from "node:child_process";

export interface DeployOptions {
  localPath: string;
  host: string;
  remotePath: string;
  sshKeyPath?: string;
}

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
