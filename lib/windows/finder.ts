import { promises as fs } from "node:fs";
import path from "node:path";
import { homeDir, specialFolder } from "./paths";

export async function existsDir(candidate: string): Promise<boolean> {
  try {
    return (await fs.stat(candidate)).isDirectory();
  } catch {
    return false;
  }
}

export async function existsFile(candidate: string): Promise<boolean> {
  try {
    return (await fs.stat(candidate)).isFile();
  } catch {
    return false;
  }
}

const SKIP_DIRS = new Set([
  "windows",
  "program files",
  "program files (x86)",
  "programdata",
  "$recycle.bin",
  "system volume information",
  "recovery",
  "node_modules",
  ".git",
  ".next",
  "appdata",
]);

/** Enumerate filesystem roots without shelling out (drives on Windows, mounts elsewhere). */
export async function filesystemRoots(): Promise<string[]> {
  if (process.platform !== "win32") {
    const roots = ["/"];
    for (const base of ["/mnt", "/media", "/home"]) {
      try {
        const entries = await fs.readdir(base, { withFileTypes: true });
        for (const e of entries) if (e.isDirectory()) roots.push(`${base}/${e.name}`);
      } catch {
        /* root missing */
      }
    }
    return roots;
  }
  const roots: string[] = [];
  for (let code = "C".charCodeAt(0); code <= "Z".charCodeAt(0); code++) {
    const root = `${String.fromCharCode(code)}:\\`;
    if (await existsDir(root)) roots.push(root);
  }
  return roots;
}

const cache = new Map<string, { found: string | null; t: number }>();

/**
 * Locate a folder by display name (e.g. "MR00100 Ai") across the user's real
 * machine: direct roots first, then a bounded shallow scan. Results are
 * cached briefly so repeated commands stay fast.
 */
export async function findNamedFolder(name: string): Promise<string | null> {
  const key = name.trim().toLowerCase().replace(/\s+/g, " ");
  if (!key) return null;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.t < 20_000) return cached.found;

  const roots = await filesystemRoots();
  const searchDirs: string[] = [];
  const home = homeDir();

  for (const root of roots) searchDirs.push(root);
  if (process.platform === "win32") {
    searchDirs.push(home);
    searchDirs.push(specialFolder("desktop"));
    searchDirs.push(specialFolder("documents"));
    searchDirs.push(specialFolder("downloads"));
  } else {
    searchDirs.push(home, path.join(home, "Desktop"), path.join(home, "Documents"), path.join(home, "Downloads"));
  }

  // 1. Direct conventional locations.
  const direct = [
    ...searchDirs.map((d) => path.join(d, name)),
    path.join(home, name),
  ];
  for (const candidate of direct) {
    if (await existsDir(candidate)) {
      cache.set(key, { found: candidate, t: Date.now() });
      return candidate;
    }
  }

  // 2. Bounded scan: root level on Windows drives, two levels under home.
  const seen = new Set<string>();
  const queue: Array<{ dir: string; depth: number }> = [];
  for (const dir of searchDirs) {
    if (seen.has(dir.toLowerCase())) continue;
    seen.add(dir.toLowerCase());
    queue.push({ dir, depth: 0 });
  }
  let scanned = 0;
  while (queue.length && scanned < 4000) {
    const { dir, depth } = queue.shift()!;
    let entries: string[] = [];
    try {
      const list = await fs.readdir(dir, { withFileTypes: true });
      entries = list.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      continue;
    }
    scanned++;
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.toLowerCase()) || entry.startsWith(".")) continue;
      const full = path.join(dir, entry);
      if (entry.toLowerCase() === key) {
        cache.set(key, { found: full, t: Date.now() });
        return full;
      }
      const maxDepth = process.platform === "win32" ? (isUnderHome(full, home) ? 2 : 1) : 2;
      if (depth < maxDepth && !seen.has(full.toLowerCase())) {
        seen.add(full.toLowerCase());
        queue.push({ dir: full, depth: depth + 1 });
      }
    }
  }

  cache.set(key, { found: null, t: Date.now() });
  return null;
}

function isUnderHome(full: string, home: string): boolean {
  const rel = path.relative(path.resolve(home), path.resolve(full));
  return rel !== "" && !rel.startsWith("..");
}
