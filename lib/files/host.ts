import { promises as fs } from "node:fs";
import path from "node:path";
import {
  assertAllowedHostPath,
  isUnder,
  isWindowsDriveRoot,
  normalizeWindowsPath,
  scopeRoot,
} from "../windows/paths";
import { openWithOs } from "../windows/shell";
import { ensureWorkspace, resolveSafe, toRelative, workspaceRoot } from "../server/workspace";
import type { FileScope } from "../commands/types";

export type Target = { abs: string; display: string; scope: FileScope | string };

export async function resolveExistingDirectory(input: string): Promise<string> {
  const normalized = normalizeWindowsPath(input);
  const stat = await fs.stat(normalized).catch(() => null);
  if (!stat) throw new Error(`Directory does not exist: ${normalized}`);
  if (!stat.isDirectory()) throw new Error(`Path is not a directory: ${normalized}`);
  return normalized;
}

export async function ensureDirectoryExists(input: string, mayCreate = true): Promise<string> {
  const normalized = normalizeWindowsPath(input);
  const stat = await fs.stat(normalized).catch(() => null);
  if (stat) {
    if (!stat.isDirectory()) throw new Error(`Path exists but is not a directory: ${normalized}`);
    return normalized;
  }
  if (isWindowsDriveRoot(normalized)) {
    // A missing drive root is a missing drive — it must never be mkdir'd.
    throw new Error(`Windows drive does not exist or is unavailable: ${normalized}`);
  }
  if (!mayCreate) throw new Error(`Directory does not exist: ${normalized}`);

  const parent = path.dirname(normalized);
  const parentStat = await fs.stat(parent).catch(() => null);
  if (!parentStat?.isDirectory()) {
    throw new Error(`Parent directory does not exist: ${parent}`);
  }
  await fs.mkdir(normalized, { recursive: false });
  const created = await fs.stat(normalized).catch(() => null);
  if (!created?.isDirectory()) throw new Error(`Directory creation could not be verified: ${normalized}`);
  return normalized;
}

export async function resolveTarget(scope: FileScope | string, relative = ""): Promise<Target> {
  const raw = (relative ?? "").trim();
  if (scope === "workspace" || !scope) {
    await ensureWorkspace();
    const abs = resolveSafe(raw || ".");
    await assertNoSymlinkEscape(workspaceRoot(), abs);
    return { abs, display: toRelative(abs) || ".", scope: "workspace" };
  }

  const root = normalizeWindowsPath(scopeRoot(scope));
  await ensureDirectoryExists(root, scope === "project" || scope === "vscode");

  const candidate = path.isAbsolute(raw) || (process.platform === "win32" && /^[A-Za-z]:[\\/]/.test(raw))
    ? normalizeWindowsPath(raw)
    : path.resolve(root, raw.replace(/^[/\\]+/, "") || ".");
  const abs = assertAllowedHostPath(candidate);
  if (!isUnder(root, abs)) {
    throw new Error(`Requested path is outside the selected ${scope} folder: ${abs}`);
  }
  await assertNoSymlinkEscape(root, abs);
  return { abs, display: abs, scope };
}

/** Ensure an existing target/ancestor does not redirect a write outside its root. */
async function assertNoSymlinkEscape(root: string, target: string) {
  const rootReal = await fs.realpath(root);
  let probe = target;
  for (;;) {
    try {
      const real = await fs.realpath(probe);
      if (!isUnder(rootReal, real)) {
        throw new Error(`Path resolves through a symbolic link outside the allowed folder: ${target}`);
      }
      return;
    } catch (error) {
      if (error instanceof Error && error.message.includes("symbolic link outside")) throw error;
      const parent = path.dirname(probe);
      if (parent === probe) throw error;
      probe = parent;
    }
  }
}

export async function writeTarget(target: Target, content: string, flag: "wx" | "w" = "w") {
  await fs.mkdir(path.dirname(target.abs), { recursive: true });
  await fs.writeFile(target.abs, content, { encoding: "utf8", flag });
}

export async function readTarget(target: Target) {
  const st = await fs.stat(target.abs);
  if (!st.isFile()) throw new Error("Not a file");
  const content = await fs.readFile(target.abs, "utf8");
  return { content, size: st.size };
}

export async function existsTarget(target: Target) {
  try {
    await fs.access(target.abs);
    return true;
  } catch {
    return false;
  }
}

export async function mkdirTarget(target: Target) {
  await fs.mkdir(target.abs, { recursive: true });
}

export async function deleteTarget(target: Target) {
  const st = await fs.stat(target.abs);
  await fs.rm(target.abs, { recursive: st.isDirectory(), force: false });
}

export async function copyTarget(from: Target, to: Target) {
  await fs.mkdir(path.dirname(to.abs), { recursive: true });
  await fs.cp(from.abs, to.abs, { recursive: true });
}

export async function moveTarget(from: Target, to: Target) {
  await fs.mkdir(path.dirname(to.abs), { recursive: true });
  await fs.rename(from.abs, to.abs);
}

export function revealInOs(target: Target) {
  openWithOs(target.abs);
}

export function describeScope(scope: string) {
  if (scope === "desktop") return "Desktop";
  if (scope === "downloads") return "Downloads";
  if (scope === "documents") return "Documents";
  if (scope === "host") return "home folder";
  if (scope === "vscode" || scope === "project") return "VS Code workspace";
  return "MR00100 workspace";
}

export { workspaceRoot };
