import { promises as fs } from "node:fs";
import path from "node:path";
import { execCapture, findExecutable, invokeBatchDetached, spawnDetachedChecked, windowsStart } from "../windows/shell";
import {
  isBlockedHostPath,
  normalizeWindowsPath,
  vscodeWorkspaceRoot,
} from "../windows/paths";
import { getSession, patchSession } from "../commands/session";

export type VsCodeCheck = {
  available: boolean;
  executable?: string;
  kind?: "cli" | "exe" | "shortcut";
  platform: NodeJS.Platform;
  reason?: string;
};

const cache = globalThis as typeof globalThis & {
  __mr00100VsCode?: { value: VsCodeCheck; at: number };
};

async function existsFile(file: string): Promise<boolean> {
  try {
    return (await fs.stat(file)).isFile();
  } catch {
    return false;
  }
}

function standardCandidates(): string[] {
  const candidates: string[] = [];
  const local = process.env.LOCALAPPDATA;
  const pf = process.env.ProgramFiles;
  const pf86 = process.env["ProgramFiles(x86)"];
  if (local) {
    candidates.push(path.join(local, "Programs", "Microsoft VS Code", "bin", "code.cmd"));
    candidates.push(path.join(local, "Programs", "Microsoft VS Code", "Code.exe"));
    candidates.push(path.join(local, "Programs", "Microsoft VS Code Insiders", "bin", "code-insiders.cmd"));
    candidates.push(path.join(local, "Programs", "Microsoft VS Code Insiders", "Code - Insiders.exe"));
  }
  for (const root of [pf, pf86].filter(Boolean) as string[]) {
    candidates.push(path.join(root, "Microsoft VS Code", "bin", "code.cmd"));
    candidates.push(path.join(root, "Microsoft VS Code", "Code.exe"));
    candidates.push(path.join(root, "Microsoft VS Code Insiders", "bin", "code-insiders.cmd"));
    candidates.push(path.join(root, "Microsoft VS Code Insiders", "Code - Insiders.exe"));
  }
  if (process.platform === "darwin") {
    candidates.push("/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code");
    candidates.push("/Applications/Visual Studio Code.app/Contents/MacOS/Electron");
  }
  return candidates;
}

export async function checkVsCode(force = false): Promise<VsCodeCheck> {
  const hit = cache.__mr00100VsCode;
  if (!force && hit && Date.now() - hit.at < 60_000) return hit.value;

  try {
    // First priority: documented CLI lookup on PATH.
    for (const name of process.platform === "win32"
      ? ["code", "code.cmd", "code.exe", "code-insiders", "code-insiders.cmd"]
      : ["code", "code-insiders"]) {
      const executable = await findExecutable(name);
      if (executable) {
        const value: VsCodeCheck = { available: true, executable, kind: /\.cmd$/i.test(executable) ? "cli" : "exe", platform: process.platform };
        cache.__mr00100VsCode = { value, at: Date.now() };
        return value;
      }
    }

    for (const candidate of standardCandidates()) {
      if (await existsFile(candidate)) {
        const value: VsCodeCheck = { available: true, executable: candidate, kind: /\.cmd$/i.test(candidate) ? "cli" : "exe", platform: process.platform };
        cache.__mr00100VsCode = { value, at: Date.now() };
        return value;
      }
    }

    const value: VsCodeCheck = {
      available: false,
      platform: process.platform,
      reason: "Visual Studio Code is not installed or the Code.exe/code CLI could not be found.",
    };
    cache.__mr00100VsCode = { value, at: Date.now() };
    return value;
  } catch (error) {
    return {
      available: false,
      platform: process.platform,
      reason: error instanceof Error ? error.message : "VS Code detection failed.",
    };
  }
}

export async function findVsCode(): Promise<string | null> {
  const check = await checkVsCode();
  return check.available ? check.executable ?? null : null;
}

async function launchCli(executable: string, args: string[]): Promise<number> {
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(executable)) {
    return invokeBatchDetached(executable, args);
  }
  if (process.platform === "win32" && /\.(lnk|url)$/i.test(executable)) {
    windowsStart(executable, args);
    return 0;
  }
  return spawnDetachedChecked(executable, args);
}

async function verifyVsCodeProcess(): Promise<boolean> {
  if (process.platform !== "win32") return true;
  await new Promise((resolve) => setTimeout(resolve, 800));
  const result = await execCapture("tasklist.exe", ["/FI", "IMAGENAME eq Code.exe", "/FO", "CSV", "/NH"], 5000);
  if (result.ok && /"Code\.exe"/i.test(result.stdout)) return true;
  const insiders = await execCapture("tasklist.exe", ["/FI", "IMAGENAME eq Code - Insiders.exe", "/FO", "CSV", "/NH"], 5000);
  return insiders.ok && /Code - Insiders\.exe/i.test(insiders.stdout);
}

function validateExistingTarget(raw: string, label: string): Promise<string> {
  const normalized = normalizeWindowsPath(raw);
  if (isBlockedHostPath(normalized)) {
    return Promise.reject(new Error(`${label} is a protected Windows system path: ${normalized}`));
  }
  return fs.stat(normalized).then((stat) => {
    if (!stat.isDirectory() && !stat.isFile()) throw new Error(`${label} is not a normal file or directory: ${normalized}`);
    return normalized;
  });
}

/** Open an existing project/file in the real VS Code desktop application. */
export async function openVsCode(
  target?: string,
  workspacePath?: string,
): Promise<{ ok: boolean; exe?: string; pid?: number; processVerified?: boolean; workspace?: string; reason?: string }> {
  const check = await checkVsCode();
  if (!check.available || !check.executable) {
    return { ok: false, reason: check.reason ?? "Visual Studio Code could not be found." };
  }

  let workspace: string;
  let requestedTarget: string;
  try {
    workspace = await validateExistingTarget(workspacePath || vscodeWorkspaceRoot(), "VS Code workspace");
    requestedTarget = target ? await validateExistingTarget(target, "VS Code target") : workspace;
  } catch (error) {
    return { ok: false, exe: check.executable, reason: error instanceof Error ? error.message : "VS Code target validation failed." };
  }

  const targetStat = await fs.stat(requestedTarget);
  if (targetStat.isFile() && !isPathInside(workspace, requestedTarget)) {
    return {
      ok: false,
      exe: check.executable,
      workspace,
      reason: `File is outside the selected VS Code workspace: ${requestedTarget}`,
    };
  }

  try {
    const args = ["--reuse-window", requestedTarget];
    const pid = await launchCli(check.executable, args);
    const processVerified = await verifyVsCodeProcess();
    if (!processVerified) {
      return {
        ok: false,
        exe: check.executable,
        pid,
        processVerified: false,
        workspace,
        reason: "The VS Code command was launched, but no Code.exe process was detected.",
      };
    }
    patchSession({
      vscodeOpen: true,
      workspaceContext: { kind: "vscode", path: workspace },
    });
    return { ok: true, exe: check.executable, pid, processVerified, workspace };
  } catch (error) {
    return {
      ok: false,
      exe: check.executable,
      workspace,
      reason: error instanceof Error ? error.message : "VS Code launch failed.",
    };
  }
}

function isPathInside(root: string, target: string) {
  const rel = path.relative(normalizeWindowsPath(root), normalizeWindowsPath(target));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export function currentVsCodeWorkspace(): string {
  return getSession().workspaceContext?.path || vscodeWorkspaceRoot();
}
