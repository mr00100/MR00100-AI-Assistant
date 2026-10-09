import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function quoteWin(value: string): string {
  if (!/[ \t"]/.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}

export function spawnDetached(command: string, args: string[] = [], cwd?: string) {
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    cwd,
    env: process.env,
    shell: false,
  });
  child.unref();
  return child.pid ?? 0;
}

/** Windows `start` requires an empty title when the target is quoted. */
export function windowsStart(target: string, args: string[] = []) {
  spawn("cmd.exe", ["/c", "start", "", target, ...args], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    shell: false,
    env: process.env,
  }).unref();
}

export async function execCapture(
  file: string,
  args: string[],
  timeout = 4000,
  cwd?: string,
): Promise<{ ok: boolean; stdout: string; stderr: string; exitCode: number | null }> {
  try {
    const { stdout, stderr } = await execFileAsync(file, args, {
      timeout,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
      cwd,
    });
    return { ok: true, stdout: String(stdout ?? ""), stderr: String(stderr ?? ""), exitCode: 0 };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message?: string; code?: number | string };
    return {
      ok: false,
      stdout: String(err.stdout ?? ""),
      stderr: String(err.stderr ?? err.message ?? ""),
      exitCode: typeof err.code === "number" ? err.code : null,
    };
  }
}

export async function findExecutable(name: string): Promise<string | null> {
  const lookup = process.platform === "win32" ? "where.exe" : "which";
  const result = await execCapture(lookup, [name], 2500);
  if (!result.ok) return null;
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? null;
}

export function spawnDetachedChecked(command: string, args: string[] = [], cwd?: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      cwd,
      env: process.env,
      shell: false,
    });
    child.once("error", reject);
    child.once("spawn", () => {
      const pid = child.pid ?? 0;
      child.unref();
      resolve(pid);
    });
  });
}

/** Launch a Windows batch CLI without enabling shell parsing for its arguments. */
export function invokeBatchDetached(batchFile: string, args: string[] = [], cwd?: string): Promise<number> {
  if (/[\"\r\n]/.test(batchFile) || args.some((arg) => /[\"\r\n]/.test(arg))) {
    return Promise.reject(new Error("VS Code path or argument contains an unsupported quote/newline."));
  }
  const command = `call "${batchFile}"${args.length ? ` ${args.map((arg) => `"${arg}"`).join(" ")}` : ""}`;
  return spawnDetachedChecked("cmd.exe", ["/d", "/s", "/c", command], cwd);
}

export function openWithOs(target: string) {
  if (process.platform === "win32") {
    windowsStart(target);
    return;
  }
  if (process.platform === "darwin") {
    spawnDetached("open", [target]);
    return;
  }
  spawnDetached("xdg-open", [target]);
}
