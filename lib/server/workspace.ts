import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Every filesystem operation MR00100 performs is sandboxed inside a single
 * workspace root. Paths that escape the root are rejected, never silently
 * clamped.
 */
export function workspaceRoot(): string {
  const configured = process.env.MR00100_WORKSPACE?.trim();
  if (configured) return path.resolve(configured);
  return path.join(process.cwd(), "mr00100-workspace");
}

export class WorkspaceError extends Error {
  constructor(
    message: string,
    readonly reason: string,
    readonly action: string,
  ) {
    super(message);
  }
}

export function resolveSafe(relative: string): string {
  const root = workspaceRoot();
  const clean = (relative ?? "").replace(/^[\\/]+/, "");
  const full = path.resolve(root, clean);
  const rel = path.relative(root, full);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new WorkspaceError(
      "PATH OUTSIDE WORKSPACE",
      `"${relative}" resolves outside the sandboxed workspace root.`,
      "Use a path relative to the workspace root, or change the workspace directory in Settings.",
    );
  }
  return full;
}

export function toRelative(full: string): string {
  return path.relative(workspaceRoot(), full).split(path.sep).join("/");
}

export type DirEntry = {
  name: string;
  path: string;
  type: "file" | "dir";
  size: number;
  modified: string;
  ext: string;
};

export async function ensureWorkspace(): Promise<string> {
  const root = workspaceRoot();
  await fs.mkdir(root, { recursive: true });
  const marker = path.join(root, ".mr00100");
  try {
    await fs.access(marker);
  } catch {
    await seedWorkspace(root);
    await fs.writeFile(
      marker,
      `MR00100 AI workspace\ncreated=${new Date().toISOString()}\nhost=${os.hostname()}\n`,
      "utf8",
    );
  }
  return root;
}

async function seedWorkspace(root: string) {
  const demo = path.join(root, "demo-project");
  await fs.mkdir(path.join(demo, "src"), { recursive: true });
  await fs.mkdir(path.join(root, "logs"), { recursive: true });
  await fs.mkdir(path.join(root, "memory"), { recursive: true });
  await fs.mkdir(path.join(root, "tmp"), { recursive: true });

  await fs.writeFile(
    path.join(demo, "package.json"),
    JSON.stringify(
      {
        name: "demo-project",
        version: "0.1.0",
        private: true,
        scripts: {
          start: "node src/index.js",
          build: "node scripts/build.js",
          test: "node --test src/*.test.js",
        },
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  await fs.writeFile(
    path.join(demo, "src", "index.js"),
    `// MR00100 AI :: demo entrypoint
// Run this from the integrated terminal:  node src/index.js
const os = require("node:os");

function report() {
  const load = os.loadavg()[0].toFixed(2);
  return {
    host: os.hostname(),
    platform: process.platform,
    cores: os.cpus().length,
    load,
  };
}

console.log("MR00100 demo online:", JSON.stringify(report(), null, 2));

module.exports = { report };
`,
    "utf8",
  );

  await fs.writeFile(
    path.join(demo, "src", "analyzer.py"),
    `"""MR00100 AI :: sample python module for developer-mode analysis."""


def fib(n: int) -> int:
    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return a


if __name__ == "__main__":
    print([fib(i) for i in range(12)])
`,
    "utf8",
  );

  await fs.mkdir(path.join(demo, "scripts"), { recursive: true });
  await fs.writeFile(
    path.join(demo, "scripts", "build.js"),
    `const fs = require("node:fs");
const path = require("node:path");

const out = path.join(__dirname, "..", "dist");
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "build.txt"), "built " + new Date().toISOString());
console.log("build complete ->", path.relative(process.cwd(), out));
`,
    "utf8",
  );

  await fs.writeFile(
    path.join(demo, "README.md"),
    `# demo-project

Seeded by **MR00100 AI** so Developer Mode has a real project to operate on.

- \`src/index.js\` — node entrypoint
- \`src/analyzer.py\` — python sample
- \`scripts/build.js\` — real build script

Try from the integrated terminal:

\`\`\`
node src/index.js
node scripts/build.js
\`\`\`
`,
    "utf8",
  );
}

const IGNORED = new Set(["node_modules", ".git", ".next", "dist-cache"]);

export async function listDir(rel: string): Promise<DirEntry[]> {
  await ensureWorkspace();
  const full = resolveSafe(rel);
  const stat = await fs.stat(full).catch(() => null);
  if (!stat) {
    throw new WorkspaceError(
      "PATH NOT FOUND",
      `"${rel || "/"}" does not exist in the workspace.`,
      "Refresh the file explorer or create the directory first.",
    );
  }
  if (!stat.isDirectory()) {
    throw new WorkspaceError(
      "NOT A DIRECTORY",
      `"${rel}" is a file.`,
      "Use the read endpoint for files.",
    );
  }
  const items = await fs.readdir(full, { withFileTypes: true });
  const out: DirEntry[] = [];
  for (const item of items) {
    if (IGNORED.has(item.name)) continue;
    const child = path.join(full, item.name);
    const st = await fs.stat(child).catch(() => null);
    if (!st) continue;
    out.push({
      name: item.name,
      path: toRelative(child),
      type: item.isDirectory() ? "dir" : "file",
      size: st.size,
      modified: st.mtime.toISOString(),
      ext: item.isDirectory() ? "" : path.extname(item.name).replace(".", ""),
    });
  }
  out.sort((a, b) =>
    a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1,
  );
  return out;
}

export async function readFileSafe(rel: string) {
  await ensureWorkspace();
  const full = resolveSafe(rel);
  const st = await fs.stat(full).catch(() => null);
  if (!st || !st.isFile()) {
    throw new WorkspaceError(
      "FILE NOT FOUND",
      `"${rel}" is not a readable file.`,
      "Check the path in the file explorer.",
    );
  }
  if (st.size > 1_500_000) {
    throw new WorkspaceError(
      "FILE TOO LARGE",
      `"${rel}" is ${(st.size / 1e6).toFixed(1)} MB (limit 1.5 MB).`,
      "Open a smaller file or split it before analysis.",
    );
  }
  const content = await fs.readFile(full, "utf8");
  return {
    path: toRelative(full),
    content,
    size: st.size,
    modified: st.mtime.toISOString(),
    ext: path.extname(full).replace(".", ""),
  };
}

export async function searchWorkspace(query: string, limit = 60) {
  await ensureWorkspace();
  const root = workspaceRoot();
  const needle = query.toLowerCase();
  const results: DirEntry[] = [];

  async function walk(dir: string, depth: number) {
    if (depth > 6 || results.length >= limit) return;
    const items = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const item of items) {
      if (results.length >= limit) return;
      if (IGNORED.has(item.name)) continue;
      const child = path.join(dir, item.name);
      if (item.isDirectory()) {
        if (item.name.toLowerCase().includes(needle)) {
          const st = await fs.stat(child).catch(() => null);
          if (st)
            results.push({
              name: item.name,
              path: toRelative(child),
              type: "dir",
              size: 0,
              modified: st.mtime.toISOString(),
              ext: "",
            });
        }
        await walk(child, depth + 1);
      } else if (item.name.toLowerCase().includes(needle)) {
        const st = await fs.stat(child).catch(() => null);
        if (st)
          results.push({
            name: item.name,
            path: toRelative(child),
            type: "file",
            size: st.size,
            modified: st.mtime.toISOString(),
            ext: path.extname(item.name).replace(".", ""),
          });
      }
    }
  }

  await walk(root, 0);
  return results;
}

export async function recentFiles(limit = 12): Promise<DirEntry[]> {
  await ensureWorkspace();
  const root = workspaceRoot();
  const found: DirEntry[] = [];
  async function walk(dir: string, depth: number) {
    if (depth > 5) return;
    const items = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const item of items) {
      if (IGNORED.has(item.name) || item.name.startsWith(".")) continue;
      const child = path.join(dir, item.name);
      if (item.isDirectory()) await walk(child, depth + 1);
      else {
        const st = await fs.stat(child).catch(() => null);
        if (!st) continue;
        found.push({
          name: item.name,
          path: toRelative(child),
          type: "file",
          size: st.size,
          modified: st.mtime.toISOString(),
          ext: path.extname(item.name).replace(".", ""),
        });
      }
    }
  }
  await walk(root, 0);
  found.sort((a, b) => b.modified.localeCompare(a.modified));
  return found.slice(0, limit);
}

export async function projectTreeSummary(maxEntries = 120): Promise<string> {
  const root = workspaceRoot();
  const lines: string[] = [];
  async function walk(dir: string, prefix: string, depth: number) {
    if (depth > 4 || lines.length >= maxEntries) return;
    const items = (await fs.readdir(dir, { withFileTypes: true }).catch(() => []))
      .filter((i) => !IGNORED.has(i.name) && !i.name.startsWith("."))
      .slice(0, 40);
    for (const item of items) {
      if (lines.length >= maxEntries) return;
      lines.push(`${prefix}${item.name}${item.isDirectory() ? "/" : ""}`);
      if (item.isDirectory()) await walk(path.join(dir, item.name), `${prefix}  `, depth + 1);
    }
  }
  await walk(root, "", 0);
  return lines.join("\n");
}
