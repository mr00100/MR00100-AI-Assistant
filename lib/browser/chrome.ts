import { promises as fs } from "node:fs";
import path from "node:path";
import { execCapture, openWithOs, spawnDetachedChecked } from "../windows/shell";

/** MR00100 treats Chrome as the primary browser; OS default is the fallback. */

const CHROME_RELATIVE_PATHS = [
  "Google\\Chrome\\Application\\chrome.exe",
  "Google\\Chrome Beta\\Application\\chrome.exe",
  "Google\\Chrome SxS\\Application\\chrome.exe",
];

function chromeSearchRoots(): string[] {
  const roots: string[] = [];
  const programFiles = process.env.ProgramFiles;
  const programFilesX86 = process.env["ProgramFiles(x86)"];
  const localAppData = process.env.LOCALAPPDATA;
  if (programFiles) roots.push(programFiles);
  if (programFilesX86) roots.push(programFilesX86);
  if (localAppData) roots.push(localAppData);
  if (process.platform !== "win32") {
    roots.push("/Applications", "/usr/bin", "/opt/google/chrome", "/snap/bin");
  }
  return roots;
}

let cached: { found: boolean; exe?: string; t: number } | null = null;

export async function findChrome(): Promise<string | null> {
  if (cached && Date.now() - cached.t < 60_000) return cached.exe ?? null;

  const lookup = process.platform === "win32" ? "where.exe" : "which";
  for (const bin of ["chrome.exe", "chrome", "google-chrome", "google-chrome-stable", "chromium"]) {
    const result = await execCapture(lookup, [bin], 2500);
    if (result.ok) {
      const hit = result.stdout.split(/\r?\n/).map((l) => l.trim()).find(Boolean);
      if (hit) {
        cached = { found: true, exe: hit, t: Date.now() };
        return hit;
      }
    }
  }

  for (const rel of CHROME_RELATIVE_PATHS) {
    for (const root of chromeSearchRoots()) {
      const full = path.join(root, rel);
      try {
        await fs.access(full);
        cached = { found: true, exe: full, t: Date.now() };
        return full;
      } catch {
        /* keep searching */
      }
    }
  }
  if (process.platform === "darwin") {
    for (const candidate of [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ]) {
      try {
        await fs.access(candidate);
        cached = { found: true, exe: candidate, t: Date.now() };
        return candidate;
      } catch {
        /* keep searching */
      }
    }
  }

  cached = { found: false, t: Date.now() };
  return null;
}

export type BrowserLaunch = { ok: boolean; browser: "chrome" | "system"; url: string; reason?: string };

/**
 * Open a URL in MR00100's one managed, visible Chrome page. If automation
 * cannot start, preserve the OS-default-browser fallback.
 */
export async function openInBrowser(url: string): Promise<BrowserLaunch> {
  const chrome = await findChrome();
  if (chrome) {
    try {
      // Dynamic import avoids a module-cycle during Chrome detection.
      const { browserTabManager } = await import("./tab-manager");
      const result = await browserTabManager().navigate(url);
      if (result.ok) return { ok: true, browser: "chrome", url: result.url ?? url };
      const fallbackReason = result.reason;
      try {
        await spawnDetachedChecked(chrome, [url]);
        return { ok: true, browser: "chrome", url, reason: `${fallbackReason ?? "Managed navigation failed"}; opened Chrome directly.` };
      } catch (error) {
        if (process.platform !== "win32") {
          openWithOs(url);
          return { ok: true, browser: "system", url, reason: `Chrome launch failed (${error instanceof Error ? error.message : "unknown"}); used the default browser.` };
        }
      }
    } catch (error) {
      try {
        await spawnDetachedChecked(chrome, [url]);
        return { ok: true, browser: "chrome", url, reason: `Managed Chrome unavailable (${error instanceof Error ? error.message : "unknown"}); opened Chrome directly.` };
      } catch {
        /* use system fallback below */
      }
    }
  }
  try {
    openWithOs(url);
    return { ok: true, browser: "system", url, reason: chrome ? undefined : "Chrome was not installed, so the Windows default browser was used." };
  } catch (error) {
    return { ok: false, browser: "system", url, reason: error instanceof Error ? error.message : "browser launch failed" };
  }
}

/** Launch Chrome directly (no URL) so the user sees the real browser window. */
export async function launchChrome(): Promise<{ ok: boolean; exe?: string; reason?: string }> {
  const chrome = await findChrome();
  if (!chrome) {
    return { ok: false, reason: "Google Chrome is not installed or was not found on PATH." };
  }
  try {
    await spawnDetachedChecked(chrome, []);
    return { ok: true, exe: chrome };
  } catch (error) {
    return { ok: false, exe: chrome, reason: error instanceof Error ? error.message : "Chrome launch failed." };
  }
}
