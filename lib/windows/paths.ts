import os from "node:os";
import path from "node:path";
import { workspaceRoot } from "../server/workspace";
import { getSession } from "../commands/session";
import type { FileScope, WorkspaceContext } from "../commands/types";

export function homeDir(): string {
  return process.env.USERPROFILE || process.env.HOME || os.homedir();
}

/** Normalize drive-relative Windows forms (D:) to a drive root (D:\\). */
export function normalizeWindowsPath(input: string): string {
  const value = input.trim().replace(/^"|"$/g, "");
  if (process.platform !== "win32") return path.resolve(value);
  if (/^[A-Za-z]:$/.test(value)) return `${value.toUpperCase()}\\`;
  if (/^[A-Za-z]:[\\/]$/.test(value)) return `${value[0].toUpperCase()}:\\`;
  if (/^[A-Za-z]:[\\/]/.test(value)) return path.win32.normalize(value);
  if (value.startsWith("\\\\")) return path.win32.normalize(value);
  return path.resolve(value);
}

export function isWindowsDriveRoot(input: string): boolean {
  return /^[A-Za-z]:[\\/]?$/.test(input.trim());
}

export type SpecialFolder = "desktop" | "downloads" | "documents" | "pictures" | "music" | "videos" | "home";

export function specialFolder(kind: SpecialFolder): string {
  const home = homeDir();
  if (kind === "home") return home;
  const names: Record<Exclude<SpecialFolder, "home">, string> = {
    desktop: "Desktop",
    downloads: "Downloads",
    documents: "Documents",
    pictures: "Pictures",
    music: "Music",
    videos: "Videos",
  };
  return path.join(home, names[kind]);
}

/** Resolve the working folder without conflating it with arbitrary host paths. */
export function getWorkspaceContext(): WorkspaceContext {
  const sessionContext = getSession().workspaceContext;
  if (sessionContext?.kind === "vscode" && sessionContext.path) {
    return { kind: "vscode", path: normalizeWindowsPath(sessionContext.path) };
  }

  const configured = process.env.MR00100_VSCODE_WORKSPACE?.trim();
  if (configured) return { kind: "vscode", path: normalizeWindowsPath(configured) };

  return { kind: "mr00100", path: workspaceRoot() };
}

export function vscodeWorkspaceRoot(): string {
  return getWorkspaceContext().path || workspaceRoot();
}

export function scopeRoot(scope: FileScope | string): string {
  switch (scope) {
    case "desktop":
      return specialFolder("desktop");
    case "downloads":
      return specialFolder("downloads");
    case "documents":
      return specialFolder("documents");
    case "host":
      return homeDir();
    case "pictures":
      return specialFolder("pictures");
    case "music":
      return specialFolder("music");
    case "videos":
      return specialFolder("videos");
    case "vscode":
    case "project":
      return vscodeWorkspaceRoot();
    case "workspace":
    default:
      return workspaceRoot();
  }
}

const BLOCKED = [
  /[\\/]windows[\\/]system32/i,
  /[\\/]windows[\\/]syswow64/i,
  /[\\/]windows[\\/]/i,
  /program files( \(x86\))?/i,
  /[\\/]\.ssh[\\/]/i,
  /[\\/]\.aws[\\/]/i,
  /ntuser\.dat/i,
];

export function isBlockedHostPath(full: string): boolean {
  return BLOCKED.some((re) => re.test(full));
}

export function isUnder(parent: string, child: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export function allowedHostRoots(): string[] {
  const roots = [homeDir(), workspaceRoot(), process.cwd()];
  const configured = process.env.MR00100_VSCODE_WORKSPACE?.trim();
  if (configured) roots.push(normalizeWindowsPath(configured));
  const active = getSession().workspaceContext;
  if (active?.kind === "vscode" && active.path) roots.push(normalizeWindowsPath(active.path));
  return [...new Set(roots.map((root) => normalizeWindowsPath(root)))];
}

export function assertAllowedHostPath(full: string) {
  const resolved = normalizeWindowsPath(full);
  if (isBlockedHostPath(resolved)) {
    throw new Error(`Protected system path is blocked: ${resolved}`);
  }
  if (!allowedHostRoots().some((root) => isUnder(root, resolved))) {
    throw new Error(`Path is outside allowed host roots: ${resolved}`);
  }
  return resolved;
}
