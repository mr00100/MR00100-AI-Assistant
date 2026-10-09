import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AssistantSettings } from "../config";
import { closeProcess, launchFallbackSearch, launchResolved, matchCatalog, resolveApp } from "../windows/apps";
import { execCapture, findExecutable, openWithOs, spawnDetached, spawnDetachedChecked, windowsStart } from "../windows/shell";
import { assertAllowedHostPath, homeDir, normalizeWindowsPath, scopeRoot, specialFolder } from "../windows/paths";
import { existsDir, existsFile, findNamedFolder } from "../windows/finder";
import type { Target } from "../files/host";
import {
  knownSite,
  luckyUrl,
  openBrowser,
  resolveWebsite,
  searchUrl,
} from "../browser/navigation";
import { openInBrowser } from "../browser/chrome";
import { openYouTube, playOnYouTube, searchYouTube } from "../browser/youtube";
import {
  emptyRecycleBin,
  gpuInfo,
  listDrives,
  openControlPanel,
  openRecycleBin,
  openStartMenu,
  openWindowsSearch,
  openWindowsSettings,
  restoreFromRecycleBin,
  runPowerAction,
  systemOverview,
  type PowerAction,
} from "../windows/system";
import { IDENTITY_ANSWER } from "./knowledge";
import { currentVsCodeWorkspace, openVsCode } from "../vscode";
import {
  copyTarget,
  deleteTarget,
  describeScope,
  existsTarget,
  mkdirTarget,
  moveTarget,
  readTarget,
  resolveTarget,
  revealInOs,
  writeTarget,
} from "../files/host";
import { generateCode } from "./templates";
import { runPlanFor } from "./run-spec";
import { getSession, patchSession, rememberBrowser, rememberFile, rememberFolder, rememberWindow } from "./session";
import { classifyAction, combineDecisions } from "./permissions";
import type { ActionResult, DesktopAction, ParsedPlan } from "./types";

/** Preflight target must mirror createCode's root resolution exactly. */
async function targetForCreateAction(action: DesktopAction) {
  const p = action.params;
  if (action.type === "code.create") {
    const generated = generateCode(p.language || "text", p.hint || p.path || "");
    let filename = p.path || generated.filename;
    if (/index\.html/i.test(p.hint || "") && /login/i.test(p.hint || "")) filename = "index.html";

    if (p.folderDescriptor) {
      if (isAbsoluteDescriptor(p.folderDescriptor)) {
        const dir = path.resolve(p.folderDescriptor.replace(/^~(?=[\\/])/, homeDir()));
        return { abs: path.join(dir, filename), display: path.join(dir, filename), scope: "vscode" };
      }
      const resolved = await resolveFolderDescriptor(p.folderDescriptor);
      if (resolved.ok && resolved.path) {
        return { abs: path.join(resolved.path, filename), display: path.join(resolved.path, filename), scope: "vscode" };
      }
      throw new Error(resolved.reason ?? `Explicit target folder was not found: ${p.folderDescriptor}`);
    }
    if (p.scope === "context") {
      const base = getSession().currentFolder || getSession().workspaceContext?.path;
      if (base) return { abs: path.join(base, filename), display: path.join(base, filename), scope: "vscode" };
    }
    return resolveTarget(p.scope === "context" ? "vscode" : p.scope || "vscode", filename);
  }
  return resolveTarget(p.scope || "workspace", p.path || "untitled.txt");
}

export async function executePlan(
  plan: ParsedPlan,
  settings: AssistantSettings,
  confirmed: boolean,
): Promise<{
  ok: boolean;
  requiresConfirmation?: boolean;
  blocked?: boolean;
  verdict?: ReturnType<typeof combineDecisions>;
  results: ActionResult[];
  speak: string;
  title: string;
  detail: string;
  data: Record<string, unknown>;
}> {
  const decisions = [];
  for (const action of plan.actions) {
    const fileMutation = action.type === "code.create" || action.type === "fs.create";
    const target = fileMutation ? await targetForCreateAction(action) : null;
    const exists = target ? await existsTarget(target) : false;
    decisions.push(classifyAction(action, settings, { exists }));
  }
  const verdict = combineDecisions(decisions);
  if (verdict.level === "BLOCK") {
    return {
      ok: false,
      blocked: true,
      verdict,
      results: [],
      speak: "That action is blocked.",
      title: "BLOCKED",
      detail: verdict.reason,
      data: {},
    };
  }
  if (verdict.level === "CONFIRM" && !confirmed) {
    return {
      ok: false,
      requiresConfirmation: true,
      verdict,
      results: [],
      speak: `Confirm: ${verdict.intentDescription}`,
      title: "CONFIRMATION REQUIRED",
      detail: verdict.reason,
      data: {},
    };
  }

  const results: ActionResult[] = [];
  const data: Record<string, unknown> = {};
  for (const action of plan.actions) {
    const result = await executeAction(action, settings, data, confirmed);
    results.push(result);
    if (result.data) Object.assign(data, result.data);
    if (!result.ok) break;
  }
  const ok = results.length > 0 && results.every((r) => r.ok);
  const speak = results
    .map((r) => r.speak)
    .filter(Boolean)
    .join(" ");
  // Browser executors already performed the real navigation. Never ask the
  // web client to window.open() the same URL again (single-task/single-tab).
  return {
    ok,
    verdict,
    results,
    speak: speak || (ok ? "Done." : "Failed."),
    title: results[0]?.title ?? plan.understanding,
    detail: results.map((r) => r.detail).filter(Boolean).join(" | "),
    data,
  };
}

async function executeAction(
  action: DesktopAction,
  _settings: AssistantSettings,
  acc: Record<string, unknown>,
  confirmed: boolean,
): Promise<ActionResult> {
  const p = action.params;
  switch (action.type) {
    case "app.open":
      return matchCatalog(p.app || "")?.id === "vscode"
        ? openVsCodeAction({})
        : openAppOrWeb(p.app || "");
    case "app.close": {
      const res = await closeProcess(p.app || "");
      return {
        ok: res.ok,
        title: "CLOSE APP",
        speak: res.ok ? `${p.app} closed.` : `Could not close ${p.app}.`,
        detail: res.stderr || res.stdout,
      };
    }
    case "os.explorer": {
      if (p.descriptor) return openFolderDescriptor(p.descriptor, "explorer");
      const launched = await openOsExplorer(homeDir());
      if (!launched.ok) {
        return { ok: false, title: "EXPLORER FAILED", speak: "I couldn't open File Explorer.", reason: launched.reason, action: "Start Explorer manually from the taskbar." };
      }
      return { ok: true, title: "FILE EXPLORER", speak: "File Explorer opened.", detail: homeDir(), data: { path: homeDir(), pid: launched.pid } };
    }
    case "os.folder":
      return openFolderDescriptor(p.descriptor || "downloads", "folder");
    case "os.open":
      return openAnyTarget(p);
    case "web.open": {
      const resolved = resolveWebsite(p.site || p.query || "");
      const launch = await openInBrowser(resolved.url);
      return {
        ok: launch.ok,
        title: "WEBSITE",
        speak: launch.ok ? `${pretty(resolved.label)} opened.` : "I couldn't open the browser.",
        detail: resolved.url,
        reason: launch.reason,
        action: launch.ok ? undefined : "Check that Chrome or another browser is installed.",
        data: { url: resolved.url, browser: launch.browser },
      };
    }
    case "web.site.search": {
      const q = (p.query || "").trim();
      const { browserTabManager, siteSearchUrl } = await import("../browser/tab-manager");
      const manager = browserTabManager();
      let result;

      if (p.site) {
        const website = resolveWebsite(p.site);
        const opened = await manager.navigate(website.url, "site-search-start");
        if (opened.ok) result = await manager.searchCurrent(q);
        else {
          // One-URL fallback: open the site's own results page, not Google and not two tabs.
          const direct = siteSearchUrl(new URL(website.url).hostname, q);
          if (direct) {
            const launch = await openInBrowser(direct);
            return {
              ok: launch.ok,
              title: "WEBSITE SEARCH",
              speak: launch.ok ? `Searching ${new URL(website.url).hostname} for ${q}.` : "I couldn't open the website search.",
              detail: direct,
              reason: launch.reason ?? opened.reason,
              data: { url: direct, browser: launch.browser, contextual: true, managed: false, singleTab: true },
            };
          }
          result = opened;
        }
      } else {
        result = await manager.searchCurrent(q);
      }

      if (!result.ok) {
        // If no site context exists, a global search is a safe, honest fallback.
        if (/no active website|chrome.*not found/i.test(result.reason ?? "")) {
          const url = searchUrl(q);
          const launch = await openInBrowser(url);
          return {
            ok: launch.ok,
            title: "WEB SEARCH",
            speak: launch.ok ? `No site was active, so I searched the web for ${q}.` : "I couldn't search the web.",
            detail: url,
            reason: launch.reason,
            data: { url, browser: launch.browser, contextual: false, singleTab: true },
          };
        }
        return {
          ok: false,
          title: "SITE SEARCH FAILED",
          speak: "I couldn't search inside the current website.",
          reason: result.reason,
          action: result.action,
          data: { url: result.url, domain: result.domain, query: q, contextual: true },
        };
      }
      return {
        ok: true,
        title: "WEBSITE SEARCH",
        speak: `Searching ${result.domain} for ${q}.`,
        detail: result.url,
        data: { url: result.url, domain: result.domain, query: q, contextual: true, reused: result.reused, managed: true, singleTab: true },
      };
    }
    case "web.search": {
      const q = (p.query || "").trim();
      // A search phrase naming a known site resolves to direct navigation, not a Google query.
      const words = q.toLowerCase().split(/\s+/);
      const siteWord = words.find((w) => knownSite(w.replace(/\b(website|site|ki|ka)\b/g, "")));
      if (siteWord && words.length <= 3) {
        const resolved = resolveWebsite(siteWord.replace(/\b(website|site|ki|ka)\b/g, ""));
        const direct = await openInBrowser(resolved.url);
        return {
          ok: direct.ok,
          title: "WEBSITE",
          speak: direct.ok ? `${pretty(resolved.label)} opened.` : "I couldn't open the browser.",
          detail: resolved.url,
          reason: direct.reason,
          data: { url: resolved.url, browser: direct.browser },
        };
      }
      const url = /\bofficial|website\b/i.test(q) ? luckyUrl(q) : searchUrl(q);
      const launch = await openInBrowser(url);
      return {
        ok: launch.ok,
        title: "WEB SEARCH",
        speak: launch.ok ? `Searching for ${q}.` : "I couldn't open the browser.",
        detail: url,
        reason: launch.reason,
        data: { url, browser: launch.browser },
      };
    }
    case "media.youtube.open": {
      const yt = await openYouTube();
      return { ok: yt.ok, title: "YOUTUBE", speak: yt.speak, detail: yt.detail, reason: yt.reason, action: yt.action, data: yt.data };
    }
    case "media.youtube.search": {
      const yt = await searchYouTube(p.query || "");
      patchSession({ lastQuery: p.query });
      return { ok: yt.ok, title: "YOUTUBE SEARCH", speak: yt.speak, detail: yt.detail, reason: yt.reason, action: yt.action, data: yt.data };
    }
    case "media.youtube.play": {
      const yt = await playOnYouTube(p.query || "");
      patchSession({ lastQuery: p.query });
      return { ok: yt.ok, title: "YOUTUBE PLAY", speak: yt.speak, detail: yt.detail, reason: yt.reason, action: yt.action, data: yt.data };
    }
    case "vscode.open":
      return openVsCodeAction(p);
    case "code.create":
      return createCode(p, confirmed);
    case "win.window.close":
    case "win.window.minimize":
    case "win.window.maximize":
    case "win.window.restore":
    case "win.window.focus":
      return windowOperation(action.type, p);
    case "win.window.list": {
      const { listWindows } = await import("../windows/window-control");
      const windows = await listWindows();
      if (!windows.length) {
        return {
          ok: false,
          title: "NO WINDOWS",
          speak: "I couldn't enumerate any open windows.",
          reason: process.platform === "win32" ? "No titled top-level windows were reported." : "Window enumeration requires Windows.",
          action: "Run MR00100 on your Windows computer.",
        };
      }
      return {
        ok: true,
        title: "OPEN WINDOWS",
        speak: `${windows.length} window${windows.length === 1 ? "" : "s"} open.`,
        detail: windows.map((w) => `${w.processName} — ${w.title}`).join("\n"),
        data: { windows },
      };
    }
    case "browser.tab.close": {
      const { browserTabManager } = await import("../browser/tab-manager");
      const manager = browserTabManager();
      if (manager.hasLivePage() || p.site) {
        const result = await manager.closeTab({ site: p.site, all: p.all === "1" });
        if (result.ok) {
          rememberBrowser({ currentUrl: undefined, currentDomain: undefined, tabId: undefined });
          return {
            ok: true,
            title: "TAB CLOSED",
            speak: p.site ? `${p.site} tab closed.` : "Tab closed.",
            detail: result.url,
            data: { closed: result.url, scope: "tab" },
          };
        }
        return { ok: false, title: "TAB CLOSE FAILED", speak: "I couldn't close that tab.", reason: result.reason, action: result.action };
      }
      // No managed page: closing a manually opened tab is not possible safely.
      return {
        ok: false,
        title: "NO MANAGED TAB",
        speak: "I don't control an open browser tab right now.",
        reason: "MR00100 can only close tabs it opened through its managed Chrome session.",
        action: "Open the site via MR00100, or say `close chrome` to close the browser window.",
      };
    }
    case "browser.window.close": {
      const { browserTabManager } = await import("../browser/tab-manager");
      const manager = browserTabManager();
      if (manager.hasLivePage()) {
        const result = await manager.closeWindow();
        if (result.ok) {
          rememberBrowser({ currentUrl: undefined, currentDomain: undefined, tabId: undefined, windowId: undefined });
          return { ok: true, title: "BROWSER CLOSED", speak: "Chrome window closed.", detail: result.url, data: { scope: "window" } };
        }
      }
      // Fall back to real OS window close for a manually launched browser.
      return windowOperation("win.window.close", { application: p.application || "chrome", all: p.all });
    }
    case "identity.answer":
      return {
        ok: true,
        title: "IDENTITY",
        speak: IDENTITY_ANSWER,
        detail: IDENTITY_ANSWER,
        data: { answer: IDENTITY_ANSWER },
      };
    case "web.research":
      // Retrieval happens in the API layer; pass the classified query through.
      return {
        ok: true,
        title: "WEB RESEARCH",
        speak: `Researching ${p.query}.`,
        detail: p.query,
        data: { query: p.query, category: p.category ?? "", reason: p.reason ?? "" },
      };
    case "ui.panel":
      return {
        ok: true,
        title: `OPEN ${(p.panel ?? "").toUpperCase()}`,
        speak: `MR00100 ${p.panel} panel opened.`,
        data: { openPanel: p.panel },
      };
    case "win.settings": {
      const result = await openWindowsSettings(p.subject || "settings");
      return { ok: result.ok, title: "WINDOWS SETTINGS", speak: result.speak, detail: result.detail, reason: result.reason, action: result.action, data: result.data };
    }
    case "win.startmenu": {
      const result = await openStartMenu();
      return { ok: result.ok, title: "START MENU", speak: result.speak, detail: result.detail, reason: result.reason, action: result.action, data: result.data };
    }
    case "win.controlpanel": {
      const result = await openControlPanel();
      return { ok: result.ok, title: "CONTROL PANEL", speak: result.speak, detail: result.detail, reason: result.reason, action: result.action, data: result.data };
    }
    case "win.search": {
      const result = await openWindowsSearch(p.query || "");
      return { ok: result.ok, title: "WINDOWS SEARCH", speak: result.speak, detail: result.detail, reason: result.reason, action: result.action, data: result.data };
    }
    case "win.recyclebin": {
      const result = await openRecycleBin();
      return { ok: result.ok, title: "RECYCLE BIN", speak: result.speak, detail: result.detail, reason: result.reason, action: result.action, data: result.data };
    }
    case "win.recyclebin.empty": {
      const result = await emptyRecycleBin();
      return { ok: result.ok, title: "RECYCLE BIN EMPTIED", speak: result.speak, detail: result.detail, reason: result.reason, action: result.action, data: result.data };
    }
    case "win.recyclebin.restore": {
      const result = await restoreFromRecycleBin(p.name || "");
      return { ok: result.ok, title: "RECYCLE BIN RESTORE", speak: result.speak, detail: result.detail, reason: result.reason, action: result.action, data: result.data };
    }
    case "fs.back": {
      const session = getSession();
      const history = session.recentFolders ?? [];
      const previous = history.find((f) => f !== session.currentFolder);
      if (!previous) {
        const current = session.currentFolder;
        const parent = current ? path.dirname(current) : "";
        if (!parent || parent === current) {
          return { ok: false, title: "NO HISTORY", speak: "There is no previous folder to go back to.", reason: "Navigation history is empty.", action: "Open a folder first." };
        }
        return openFolderDescriptor(parent, "folder");
      }
      return openFolderDescriptor(previous, "folder");
    }
    case "fs.open.typed":
      return openTypedFile(p);
    case "win.power": {
      const result = await runPowerAction((p.action || "lock") as PowerAction);
      return { ok: result.ok, title: "POWER", speak: result.speak, detail: result.detail, reason: result.reason, action: result.action, data: { action: p.action, ...(result.data ?? {}) } };
    }
    case "win.drives": {
      const result = await listDrives();
      return { ok: result.ok, title: "DRIVES", speak: result.speak, detail: result.detail, reason: result.reason, data: result.data };
    }
    case "win.info": {
      const result = await systemOverview();
      return { ok: result.ok, title: "SYSTEM INFO", speak: result.speak, detail: result.detail, reason: result.reason, data: result.data };
    }
    case "win.gpu": {
      const result = await gpuInfo();
      return { ok: result.ok, title: "GPU", speak: result.speak, detail: result.detail, reason: result.reason, action: result.action, data: result.data };
    }
    case "fs.listdir":
      return listDirectoryAction(p);
    case "fs.append":
      return appendToFile(p);
    case "fs.edit":
      return editFileAction(p, confirmed);
    case "fs.searchhost":
      return searchHostFiles(p);
    case "fs.create": {
      const target = await resolveTarget(p.scope || "workspace", p.path || "untitled.txt");
      const exists = await existsTarget(target);
      if (exists && !confirmed) {
        return { ok: false, title: "OVERWRITE DENIED", speak: "File already exists.", reason: `Overwrite confirmation is required for ${target.display}.` };
      }
      await writeTarget(target, p.content ?? "", exists ? "w" : "wx");
      if (p.openVscode === "1") {
        const opened = await openVsCode(target.abs, scopeRoot(p.scope || "workspace"));
        if (!opened.ok) return { ok: false, title: "FILE CREATED", speak: "File created, but VS Code could not open it.", detail: target.display, reason: opened.reason, action: "Verify the VS Code installation and CLI path." };
      }
      return {
        ok: true,
        title: "FILE CREATED",
        speak: `File created in ${describeScope(String(target.scope))}.`,
        detail: target.display,
        data: { path: target.display },
      };
    }
    case "fs.mkdir": {
      // "context" scope = create inside the folder/project we are working in.
      let target;
      if (p.scope === "context") {
        const base = getSession().currentFolder || getSession().workspaceContext?.path;
        if (!base) {
          return {
            ok: false,
            title: "NO FOLDER CONTEXT",
            speak: "I'm not sure which folder you mean.",
            reason: "No active folder or project is set in this session.",
            action: "Open a folder or project first, then say `create a folder in this`.",
          };
        }
        const abs = assertAllowedHostPath(path.join(base, p.path || "new-folder"));
        target = { abs, display: abs, scope: "host" };
      } else {
        target = await resolveTarget(p.scope || "workspace", p.path || "new-folder");
      }
      await mkdirTarget(target);
      const verified = await existsDir(target.abs);
      if (verified) {
        rememberFolder(target.abs, path.basename(target.abs));
        patchSession({ lastCreatedFolder: target.abs, lastAction: `created folder ${path.basename(target.abs)}` });
      }
      return {
        ok: verified,
        title: verified ? "FOLDER CREATED" : "FOLDER CREATE FAILED",
        speak: verified ? `${path.basename(target.abs)} folder created.` : "I couldn't verify the folder was created.",
        detail: target.display,
        reason: verified ? undefined : `The directory was not present after creation: ${target.abs}`,
        data: { path: target.abs, verified },
      };
    }
    case "fs.save": {
      // Files are written atomically on create/edit, so "save" verifies state.
      const current = getSession().currentFile;
      if (!current) {
        return {
          ok: false,
          title: "NOTHING TO SAVE",
          speak: "There is no active file to save.",
          reason: "No file has been created or edited in this session.",
          action: "Create or edit a file first.",
        };
      }
      const stat = await fs.stat(current).catch(() => null);
      if (!stat?.isFile()) {
        return {
          ok: false,
          title: "SAVE FAILED",
          speak: "The active file no longer exists on disk.",
          reason: `No file exists at ${current}.`,
          action: "Recreate the file, then save.",
        };
      }
      patchSession({ lastAction: `saved ${path.basename(current)}` });
      return {
        ok: true,
        title: "SAVED",
        speak: `${path.basename(current)} is saved.`,
        detail: `${current} · ${stat.size} bytes`,
        data: { path: current, bytes: stat.size, verified: true },
      };
    }
    case "browser.open.file": {
      const current = p.path || getSession().currentFile;
      if (!current) {
        return {
          ok: false,
          title: "NO FILE CONTEXT",
          speak: "There is no active file to open in the browser.",
          reason: "No file has been created or edited in this session.",
          action: "Create a file first, then say `open it in browser`.",
        };
      }
      const stat = await fs.stat(current).catch(() => null);
      if (!stat?.isFile()) {
        return {
          ok: false,
          title: "FILE NOT FOUND",
          speak: `${path.basename(current)} was not found.`,
          reason: `No file exists at ${current}.`,
          action: "Recreate the file and retry.",
        };
      }
      const fileUrl = pathToFileUrl(current);
      const launch = await openInBrowser(fileUrl);
      if (launch.ok) rememberBrowser({ browser: launch.browser, currentUrl: fileUrl, currentDomain: "file", openedByAssistant: true });
      return {
        ok: launch.ok,
        title: launch.ok ? "OPENED IN BROWSER" : "BROWSER OPEN FAILED",
        speak: launch.ok ? `${path.basename(current)} opened in the browser.` : "I couldn't open the file in a browser.",
        detail: fileUrl,
        reason: launch.reason,
        action: launch.ok ? undefined : "Check that Chrome or another browser is installed.",
        data: { url: fileUrl, browser: launch.browser, path: current },
      };
    }
    case "fs.open": {
      const target = await resolveTarget(p.scope || "workspace", p.path || ".");
      revealInOs(target);
      return { ok: true, title: "OPEN FILE", speak: "Opened.", detail: target.display };
    }
    case "fs.read": {
      const target = await resolveTarget(p.scope || "workspace", p.path || "");
      const file = await readTarget(target);
      return { ok: true, title: "READ FILE", speak: "File loaded.", detail: file.content.slice(0, 400) };
    }
    case "fs.delete": {
      const target = await resolveHostFile(p, "path");
      if (!(await pathExistsAny(target.abs))) {
        return { ok: false, title: "NOT FOUND", speak: `${path.basename(target.abs)} was not found.`, reason: `Nothing exists at ${target.abs}.`, action: "Check the name or open the correct folder first." };
      }
      await deleteTarget(target);
      const verified = !(await pathExistsAny(target.abs));
      return {
        ok: verified,
        title: verified ? "DELETED" : "DELETE FAILED",
        speak: verified ? `${path.basename(target.abs)} deleted.` : "I couldn't verify the deletion.",
        detail: target.display,
        reason: verified ? undefined : "The item was still present after the delete operation.",
        data: { path: target.abs, verified },
      };
    }
    case "fs.rename": {
      const from = await resolveHostFile(p, "path");
      if (!p.to) {
        return { ok: false, title: "NEW NAME REQUIRED", speak: `What should I rename ${path.basename(from.abs)} to?`, reason: "No destination name was given.", action: "Say for example `rename this file to report.txt`." };
      }
      const destination = path.join(path.dirname(from.abs), path.basename(p.to || ""));
      const to: Target = { abs: destination, display: destination, scope: from.scope };
      if (!(await existsFile(from.abs))) {
        return { ok: false, title: "FILE NOT FOUND", speak: `${path.basename(from.abs)} was not found.`, reason: `No file exists at ${from.abs}.`, action: "Open the correct folder first, or use the full path." };
      }
      await moveTarget(from, to);
      const verified = await existsFile(to.abs);
      return {
        ok: verified,
        title: verified ? "RENAMED" : "RENAME FAILED",
        speak: verified ? `${path.basename(from.abs)} renamed to ${path.basename(to.abs)}.` : "I couldn't rename that file.",
        detail: `${from.display} → ${to.display}`,
        reason: verified ? undefined : "The destination file was not present after the rename.",
        data: { from: from.abs, to: to.abs, verified },
      };
    }
    case "fs.copy": {
      const from = await resolveHostFile(p, "path");
      if (!(await pathExistsAny(from.abs))) {
        return { ok: false, title: "ITEM NOT FOUND", speak: `${path.basename(from.abs)} was not found.`, reason: `Nothing exists at ${from.abs}.`, action: "Check the name and retry." };
      }
      const to = await resolveDestination(p.to || "", from);
      await copyTarget(from, to);
      const verified = await pathExistsAny(to.abs);
      return {
        ok: verified,
        title: verified ? "COPIED" : "COPY FAILED",
        speak: verified ? `Copied to ${path.basename(to.abs)}.` : "I couldn't copy that file.",
        detail: `${from.display} → ${to.display}`,
        reason: verified ? undefined : "The copy was not present at the destination.",
        data: { from: from.abs, to: to.abs, verified },
      };
    }
    case "fs.move": {
      const from = await resolveHostFile(p, "path");
      if (!(await pathExistsAny(from.abs))) {
        return { ok: false, title: "NOT FOUND", speak: `${path.basename(from.abs)} was not found.`, reason: `Nothing exists at ${from.abs}.`, action: "Check the source and retry." };
      }
      const to = await resolveDestination(p.to || "", from);
      await moveTarget(from, to);
      const verified = await pathExistsAny(to.abs);
      return {
        ok: verified,
        title: verified ? "MOVED" : "MOVE FAILED",
        speak: verified ? `Moved to ${path.basename(to.abs)}.` : "I couldn't move that item.",
        detail: `${from.display} → ${to.display}`,
        reason: verified ? undefined : "The item was not present at the destination.",
        data: { from: from.abs, to: to.abs, verified },
      };
    }
    case "code.run":
      return runCode(p);
    default:
      return { ok: false, title: "UNKNOWN", speak: "Unknown action.", reason: action.type };
  }
}

async function openAppOrWeb(app: string): Promise<ActionResult> {
  const label = pretty(app);
  const resolved = await resolveApp(app);
  if (resolved.found && resolved.exe) {
    try {
      const launched = await launchResolved(resolved.exe);
      rememberWindow({
        processId: launched.pid,
        application: resolved.id,
        executablePath: resolved.exe,
        openedByAssistant: true,
        openedAt: Date.now(),
        state: "active",
      });
      patchSession({ lastApp: resolved.id, lastAction: `opened ${resolved.id}` });
      return { ok: true, title: "LAUNCH", speak: `${label} opened.`, detail: resolved.exe, data: { app: resolved.id, exe: resolved.exe, pid: launched.pid } };
    } catch (error) {
      return {
        ok: false,
        title: "LAUNCH FAILED",
        speak: `I found ${label} but could not start it.`,
        detail: resolved.exe,
        reason: error instanceof Error ? error.message : "process launch failed",
        action: "Start the application manually, or check its installation.",
      };
    }
  }

  // Not installed: fall back to the real browser, but say so honestly.
  const website = resolveWebsite(app);
  const target = website.mode === "direct" ? website.url : launchFallbackSearch(app);
  const launch = await openInBrowser(target);
  if (!launch.ok) {
    return {
      ok: false,
      title: "NOT INSTALLED",
      speak: `${label} is not installed, and I couldn't open a browser either.`,
      reason: `Executable not found on PATH or in standard locations; browser launch also failed (${launch.reason ?? "unknown"}).`,
      action: `Install ${label} and try again.`,
    };
  }
  const fallbackNote = website.mode === "direct" ? `${label} is not installed, so I opened its website.` : `${label} is not installed, so I searched the web for it.`;
  return {
    ok: true,
    title: "WEB FALLBACK",
    speak: fallbackNote,
    detail: target,
    data: { url: target, browser: launch.browser, installed: false },
  };
}

/** Resolve an absolute, drive, special-name or display-name folder descriptor against the real machine. */
async function resolveFolderDescriptor(descriptor: string): Promise<{ ok: boolean; path?: string; name?: string; reason?: string; action?: string }> {
  const raw = (descriptor ?? "").trim().replace(/^["']|["']$/g, "");
  if (!raw) return { ok: false, reason: "No folder was specified.", action: "Name the folder or give its full path." };

  if (/^[A-Za-z]:$/.test(raw) || /^[A-Za-z]:[\\/]$/.test(raw)) {
    const drive = `${raw[0].toUpperCase()}:\\`;
    if (await existsDir(drive)) return { ok: true, path: drive, name: `${raw[0].toUpperCase()}: drive` };
    return { ok: false, reason: `Drive ${drive} was not found on this machine.`, action: "Check the drive letter and retry." };
  }

  const special = raw.toLowerCase().replace(/\s+folder$/, "").replace(/s$/, "");
  if (SPECIAL_DESCRIPTOR_MAP[special]) {
    const dir = SPECIAL_DESCRIPTOR_MAP[special]();
    if (await existsDir(dir)) return { ok: true, path: dir, name: raw.replace(/\b\w/g, (c) => c.toUpperCase()) };
    return { ok: false, reason: `The ${raw} folder does not exist at ${dir}.`, action: "Verify the folder location in Windows settings." };
  }

  if (isAbsoluteDescriptor(raw)) {
    const abs = path.resolve(raw.replace(/^~(?=[\\/])/, homeDir()));
    if (await existsDir(abs)) return { ok: true, path: abs, name: path.basename(abs) || abs };
    return { ok: false, reason: `${raw} was not found at ${abs}.`, action: "Check the path, or say `create folder " + raw + "` to create it." };
  }

  const found = await findNamedFolder(raw);
  if (found) return { ok: true, path: found, name: path.basename(found) };
  return {
    ok: false,
    reason: `"${raw}" folder was not found.`,
    action: "Give the full path (for example D:\\MR00100 Ai), or create the folder first.",
  };
}

const SPECIAL_DESCRIPTOR_MAP: Record<string, () => string> = {
  desktop: () => specialFolder("desktop"),
  download: () => specialFolder("downloads"),
  document: () => specialFolder("documents"),
  picture: () => specialFolder("pictures"),
  pictures: () => specialFolder("pictures"),
  music: () => specialFolder("music"),
  video: () => specialFolder("videos"),
  videos: () => specialFolder("videos"),
  home: () => homeDir(),
  workspace: () => scopeRoot("workspace"),
  projects: () => scopeRoot("vscode"),
  project: () => scopeRoot("vscode"),
};

function isAbsoluteDescriptor(value: string): boolean {
  return /^[A-Za-z]:([\\/]|$)/.test(value) || value.startsWith("\\\\") || /^~[\\/]/.test(value) || value.startsWith("/");
}

async function openOsExplorer(dir: string): Promise<{ ok: boolean; pid?: number; reason?: string }> {
  try {
    if (process.platform === "win32") {
      const pid = await spawnDetachedChecked("explorer.exe", [dir]);
      return { ok: true, pid };
    }
    const executable = process.platform === "darwin" ? "open" : "xdg-open";
    const pid = await spawnDetachedChecked(executable, [dir]);
    return { ok: true, pid };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "file manager launch failed" };
  }
}

async function openFolderDescriptor(descriptor: string, labelKind: string): Promise<ActionResult> {
  const resolved = await resolveFolderDescriptor(descriptor);
  if (!resolved.ok || !resolved.path) {
    return {
      ok: false,
      title: "FOLDER NOT FOUND",
      speak: resolved.reason ?? "Folder not found.",
      reason: resolved.reason,
      action: resolved.action,
    };
  }
  const launched = await openOsExplorer(resolved.path);
  if (!launched.ok) {
    // The folder itself resolved to a real path, so keep that context even
    // though the shell could not be launched — later "in this" still works.
    rememberFolder(resolved.path, resolved.name ?? path.basename(resolved.path));
    patchSession({ workspaceContext: { kind: "vscode", path: resolved.path } });
    return {
      ok: false,
      title: "EXPLORER FAILED",
      speak: `I found ${resolved.name ?? resolved.path}, but couldn't open File Explorer.`,
      reason: launched.reason,
      action: "Open the folder manually in File Explorer.",
      data: { path: resolved.path, contextRetained: true },
    };
  }
  rememberFolder(resolved.path, resolved.name ?? path.basename(resolved.path));
  rememberWindow({
    processId: launched.pid,
    application: "explorer",
    title: resolved.path,
    openedByAssistant: true,
    openedAt: Date.now(),
    state: "active",
  });
  patchSession({
    workspaceContext: { kind: "vscode", path: resolved.path },
    lastAction: `opened folder ${resolved.path}`,
  });
  const name = resolved.name ?? path.basename(resolved.path);
  return {
    ok: true,
    title: labelKind === "explorer" ? "FILE EXPLORER" : "OPEN FOLDER",
    speak: `${name}${/folder$/i.test(name) ? "" : " folder"} opened.`,
    detail: resolved.path,
    data: { path: resolved.path, pid: launched.pid },
  };
}

/** Open an arbitrary absolute target: folders in Explorer, files revealed/opened appropriately. */
async function openAnyTarget(p: Record<string, string>): Promise<ActionResult> {
  let targetPath: string | null = null;
  let targetIsFile = false;

  if (p.pronoun === "1") {
    const session = getSession();
    if (session.lastFolder?.path) targetPath = session.lastFolder.path;
    else if (session.lastFile?.path) {
      targetPath = session.lastFile.path;
      targetIsFile = true;
    }
    if (!targetPath) {
      return {
        ok: false,
        title: "NOTHING TO OPEN",
        speak: "There is no current folder or file selected.",
        reason: "No previous folder or file context exists in this session.",
        action: "Open a folder or file first, then say `open it` again.",
      };
    }
  } else {
    const descriptor = (p.descriptor ?? "").trim();
    if (!descriptor) {
      return { ok: false, title: "NO TARGET", speak: "No path was specified.", reason: "The command did not contain a folder or file path.", action: "Provide a full path such as D:\\Projects." };
    }
    if (isAbsoluteDescriptor(descriptor)) {
      const abs = path.resolve(descriptor.replace(/^~(?=[\\/])/, homeDir()));
      const st = await fs.stat(abs).catch(() => null);
      if (!st) {
        return {
          ok: false,
          title: "PATH NOT FOUND",
          speak: `${descriptor} was not found.`,
          reason: `Nothing exists at ${abs}.`,
          action: "Check the path carefully, or ask me to search for the folder by name.",
        };
      }
      targetPath = abs;
      targetIsFile = st.isFile();
    } else if (descriptor.includes(".") || CODE_SOURCE_EXTS.has(fileExt(descriptor))) {
      // named file -> try session, vscode project, workspace, then finder
      const session = getSession();
      const candidates: string[] = [];
      if (session.lastFile?.path && path.basename(session.lastFile.path).toLowerCase() === descriptor.toLowerCase()) candidates.push(session.lastFile.path);
      const scoped = ["vscode", "workspace"] as const;
      for (const scope of scoped) {
        try {
          const t = await resolveTarget(scope, descriptor);
          candidates.push(t.abs);
        } catch {
          /* not inside allowed roots */
        }
      }
      const hit = await firstExisting(candidates.filter(Boolean));
      if (!hit) {
        return {
          ok: false,
          title: "FILE NOT FOUND",
          speak: `${descriptor} was not found.`,
          reason: `Could not locate ${descriptor} in the current project or workspace.`,
          action: "Open the project folder first, or give the full path.",
        };
      }
      targetPath = hit;
      targetIsFile = true;
    } else {
      // treat as folder descriptor
      return openFolderDescriptor(descriptor, "folder");
    }
  }

  if (!targetPath) {
    return { ok: false, title: "TARGET UNRESOLVED", speak: "I couldn't resolve that target.", reason: "Path resolution failed.", action: "Try a full path." };
  }

  if (targetIsFile) {
    openFileAt(targetPath);
    patchSession({ lastFile: { path: targetPath, scope: "host" }, lastFolder: { path: path.dirname(targetPath), name: path.basename(path.dirname(targetPath)) } });
    return {
      ok: true,
      title: "FILE OPENED",
      speak: `${path.basename(targetPath)} opened.`,
      detail: targetPath,
      data: { path: targetPath, file: true },
    };
  }
  const launched = await openOsExplorer(targetPath);
  if (!launched.ok) {
    return {
      ok: false,
      title: "EXPLORER FAILED",
      speak: `I found ${path.basename(targetPath) || targetPath}, but couldn't open it in Explorer.`,
      reason: launched.reason,
      action: "Open the folder manually.",
      data: { path: targetPath },
    };
  }
  rememberFolder(targetPath, path.basename(targetPath));
  rememberWindow({
    processId: launched.pid,
    application: "explorer",
    title: targetPath,
    openedByAssistant: true,
    openedAt: Date.now(),
    state: "active",
  });
  patchSession({ workspaceContext: { kind: "vscode", path: targetPath } });
  const name = path.basename(targetPath) || targetPath;
  return {
    ok: true,
    title: "FOLDER OPENED",
    speak: `${name}${/folder|drive|:$/i.test(name) ? "" : " folder"} opened.`,
    detail: targetPath,
    data: { path: targetPath, pid: launched.pid },
  };
}

const CODE_SOURCE_EXTS = new Set(["py", "js", "jsx", "ts", "tsx", "html", "css", "c", "cpp", "java", "cs", "php", "sql", "go", "rs", "json", "md", "txt"]);

function pathToFileUrl(absolute: string): string {
  const normalized = absolute.replace(/\\/g, "/");
  const withLeadingSlash = /^[A-Za-z]:/.test(normalized) ? `/${normalized}` : normalized;
  return `file://${encodeURI(withLeadingSlash).replace(/#/g, "%23")}`;
}

function fileExt(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

async function firstExisting(candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    const st = await fs.stat(candidate).catch(() => null);
    if (st) return candidate;
  }
  return null;
}

function openFileAt(abs: string) {
  if (process.platform === "win32") {
    spawnDetached("explorer.exe", [`/select,${abs}`]);
    return;
  }
  openWithOs(abs);
}

const TYPE_EXTENSIONS: Record<string, string[]> = {
  pdf: ["pdf"],
  video: ["mp4", "mkv", "avi", "mov", "webm", "wmv"],
  image: ["jpg", "jpeg", "png", "gif", "webp", "bmp"],
  picture: ["jpg", "jpeg", "png", "gif", "webp", "bmp"],
  photo: ["jpg", "jpeg", "png", "gif", "webp"],
  "python file": ["py"],
  python: ["py"],
  "text file": ["txt"],
  text: ["txt", "md"],
  document: ["docx", "doc", "pdf", "txt", "md"],
  "word file": ["docx", "doc"],
  "excel file": ["xlsx", "xls", "csv"],
  spreadsheet: ["xlsx", "xls", "csv"],
  presentation: ["pptx", "ppt"],
  zip: ["zip", "rar", "7z"],
  audio: ["mp3", "wav", "flac", "m4a"],
  song: ["mp3", "wav", "flac", "m4a"],
  "music file": ["mp3", "wav", "flac", "m4a"],
  "html file": ["html", "htm"],
  "css file": ["css"],
  "js file": ["js", "mjs"],
  "json file": ["json"],
  markdown: ["md"],
  readme: ["md"],
};

/** Open the newest file of a requested kind in a folder using the OS association. */
async function openTypedFile(p: Record<string, string>): Promise<ActionResult> {
  const exts = TYPE_EXTENSIONS[p.kind] ?? [];
  if (!exts.length) {
    return { ok: false, title: "UNKNOWN FILE TYPE", speak: `I don't know which files count as "${p.kind}".`, reason: `No extension mapping for ${p.kind}.`, action: "Name the file directly." };
  }
  const session = getSession();
  let folder = p.folder;
  if (!folder) folder = session.currentFolder || session.workspaceContext?.path || "";
  if (!folder) {
    return { ok: false, title: "NO FOLDER CONTEXT", speak: "Which folder should I look in?", reason: "No folder is currently open and none was specified.", action: "Say for example `open the PDF in D drive`." };
  }
  let abs: string;
  try {
    abs = assertAllowedHostPath(normalizeWindowsPath(folder));
  } catch (error) {
    return { ok: false, title: "FOLDER DENIED", speak: "I can't browse that location.", reason: error instanceof Error ? error.message : "Path not allowed.", action: "Choose a regular user folder." };
  }
  if (!(await existsDir(abs))) {
    return { ok: false, title: "FOLDER NOT FOUND", speak: `${folder} was not found.`, reason: `Nothing exists at ${abs}.`, action: "Check the drive or folder name." };
  }
  const entries = await fs.readdir(abs, { withFileTypes: true }).catch(() => []);
  const candidates: Array<{ file: string; mtime: number }> = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = entry.name.split(".").pop()?.toLowerCase() ?? "";
    if (!exts.includes(ext)) continue;
    const full = path.join(abs, entry.name);
    const st = await fs.stat(full).catch(() => null);
    if (st) candidates.push({ file: full, mtime: st.mtimeMs });
  }
  if (!candidates.length) {
    return { ok: false, title: "NO MATCHING FILE", speak: `No ${p.kind} was found in ${path.basename(abs) || abs}.`, reason: `No file with extension ${exts.join("/")} exists in ${abs}.`, action: "Check the folder or name the file directly." };
  }
  candidates.sort((a, b) => b.mtime - a.mtime);
  const target = candidates[0].file;
  try {
    // Open with the OS default association (real PDF reader, media player, etc.).
    if (process.platform === "win32") await spawnDetachedChecked("cmd.exe", ["/d", "/c", "start", "", target]);
    else await spawnDetachedChecked(process.platform === "darwin" ? "open" : "xdg-open", [target]);
  } catch (error) {
    return { ok: false, title: "OPEN FAILED", speak: `I found ${path.basename(target)} but couldn't open it.`, reason: error instanceof Error ? error.message : "launch failed", action: "Open the file manually.", data: { path: target } };
  }
  rememberFile(target, { scope: "host" });
  rememberFolder(abs, path.basename(abs));
  patchSession({ lastAction: `opened ${path.basename(target)}` });
  return {
    ok: true,
    title: "FILE OPENED",
    speak: `${path.basename(target)} opened.`,
    detail: target,
    data: { path: target, matches: candidates.length },
  };
}

const SPECIAL_SCOPE_NAMES: Record<string, string> = {
  desktop: "desktop",
  downloads: "downloads",
  download: "downloads",
  documents: "documents",
  pictures: "host",
  music: "host",
  videos: "host",
};

/**
 * Resolve a user-supplied file reference against the real machine.
 * Bare filenames use the active folder/project context, never a guess.
 */
async function resolveHostFile(p: Record<string, string>, key: "path" | "to"): Promise<Target> {
  const raw = (p[key] ?? "").trim().replace(/^["']|["']$/g, "");
  // "this file" / "ye file" → the file we most recently created, edited or opened.
  if (!raw && key === "path" && p.contextual === "1") {
    const current = getSession().currentFile;
    if (!current) throw new Error("There is no current file in this session. Open or create a file first.");
    return { abs: current, display: current, scope: "host" };
  }
  if (!raw) throw new Error("No file or folder name was provided.");

  if (isAbsoluteDescriptor(raw)) {
    return resolveTarget("host", raw);
  }
  const lower = raw.toLowerCase();
  if (SPECIAL_SCOPE_NAMES[lower]) {
    return resolveTarget(SPECIAL_SCOPE_NAMES[lower], raw.toLowerCase().endsWith(".") ? "" : lower);
  }
  if (lower === "workspace") return resolveTarget("workspace", ".");

  const session = getSession();
  const candidates: Array<{ scope: string; base: string }> = [];
  if (session.lastFile?.path) candidates.push({ scope: "host", base: path.dirname(session.lastFile.path) });
  if (session.lastFolder?.path) candidates.push({ scope: "host", base: session.lastFolder.path });
  if (session.workspaceContext?.path) candidates.push({ scope: "host", base: session.workspaceContext.path });

  for (const candidate of candidates) {
    const full = path.join(candidate.base, raw);
    if (await existsFile(full)) return { abs: full, display: full, scope: candidate.scope };
  }
  // Fall back to the explicit scope root (may not exist yet for copy targets).
  return resolveTarget(p.scope && p.scope !== "host" ? p.scope : "vscode", raw);
}

async function pathExistsAny(candidate: string): Promise<boolean> {
  return fs.stat(candidate).then(() => true).catch(() => false);
}

async function resolveDestination(rawDestination: string, source: Target): Promise<Target> {
  const raw = rawDestination.trim().replace(/^["']|["']$/g, "");
  const lower = raw.toLowerCase().replace(/\s+folder$/, "");
  if (SPECIAL_SCOPE_NAMES[lower]) {
    const root = scopeRoot(SPECIAL_SCOPE_NAMES[lower]);
    const abs = path.join(root, path.basename(source.abs));
    return { abs, display: abs, scope: SPECIAL_SCOPE_NAMES[lower] };
  }
  if (isAbsoluteDescriptor(raw)) {
    const normalized = normalizeWindowsPath(raw);
    const stat = await fs.stat(normalized).catch(() => null);
    const abs = stat?.isDirectory() ? path.join(normalized, path.basename(source.abs)) : normalized;
    return { abs, display: abs, scope: "host" };
  }
  // A simple filename stays beside the source; a named folder is resolved by name.
  if (/^[^\\/]+\.[A-Za-z0-9]{1,8}$/.test(raw)) {
    const abs = path.join(path.dirname(source.abs), raw);
    return { abs, display: abs, scope: source.scope };
  }
  const folder = await resolveFolderDescriptor(raw);
  if (folder.ok && folder.path) {
    const abs = path.join(folder.path, path.basename(source.abs));
    return { abs, display: abs, scope: "host" };
  }
  throw new Error(folder.reason ?? `Destination could not be resolved: ${raw}`);
}

const WINDOW_OP_LABEL: Record<string, string> = {
  "win.window.close": "closed",
  "win.window.minimize": "minimized",
  "win.window.maximize": "maximized",
  "win.window.restore": "restored",
  "win.window.focus": "focused",
};

/**
 * Resolve a window target (explicit app, title hint, or contextual "this")
 * and perform the real Windows operation, then verify it.
 */
async function windowOperation(type: string, p: Record<string, string>): Promise<ActionResult> {
  const { applyWindowOperation, findWindows, listWindows } = await import("../windows/window-control");
  const operation = type.replace("win.window.", "") as "close" | "minimize" | "maximize" | "restore" | "focus";

  if (process.platform !== "win32") {
    return {
      ok: false,
      title: "WINDOW CONTROL UNAVAILABLE",
      speak: "Window control is only available on Windows.",
      reason: `Window management uses the Windows shell APIs, but this host is ${process.platform}.`,
      action: "Run MR00100 on your Windows computer.",
    };
  }

  const session = getSession();
  let application: string | undefined = p.application;
  let titleContains: string | undefined = p.titleContains;

  // Contextual "this / isko / it" → most recent assistant-opened window.
  if (!application && p.contextual === "1") {
    const context = session.activeWindow ?? session.lastOpenedWindow;
    if (context?.application || context?.handle) {
      application = context.application;
      titleContains = titleContains ?? context.title;
    } else if (session.currentApp) {
      application = session.currentApp;
    } else {
      return {
        ok: false,
        title: "NO WINDOW CONTEXT",
        speak: "I'm not sure which window you mean.",
        reason: "No window has been opened through MR00100 in this session.",
        action: "Name the application, for example `close Explorer`.",
      };
    }
  }

  if (!application) {
    return {
      ok: false,
      title: "NO WINDOW TARGET",
      speak: "Which window should I act on?",
      reason: "The command did not identify an application or an active window.",
      action: "Name the application, for example `minimize Chrome`.",
    };
  }

  let matches = await findWindows({ application, titleContains });
  // A title hint that matches nothing should not hide the app's real windows.
  if (!matches.length && titleContains) matches = await findWindows({ application });
  if (!matches.length) {
    const open = await listWindows();
    return {
      ok: false,
      title: "WINDOW NOT FOUND",
      speak: `No open ${application} window was found.`,
      reason: `${application} does not currently have a visible window.`,
      action: open.length ? `Open windows: ${open.map((w) => w.processName).join(", ")}.` : "Open the application first.",
    };
  }

  const all = p.all === "1";
  // Genuine ambiguity: several windows of the same app and no distinguishing hint.
  if (!all && matches.length > 1 && !titleContains && p.contextual !== "1") {
    return {
      ok: false,
      title: "WHICH WINDOW?",
      speak: `There are ${matches.length} ${application} windows open. Which one should I ${operation}?`,
      reason: "Multiple matching windows exist and the request did not identify one.",
      action: `Say for example: ${operation} ${application} window showing "${matches[0].title.slice(0, 40)}".`,
      data: { ambiguous: matches.map((m) => ({ title: m.title, processId: m.processId })) },
    };
  }

  const targets = all ? matches : [matches[0]];
  const result = await applyWindowOperation(operation, targets);
  if (!result.ok) {
    return {
      ok: false,
      title: `WINDOW ${operation.toUpperCase()} FAILED`,
      speak: `I couldn't ${operation} ${application}.`,
      reason: result.reason,
      action: result.action,
    };
  }

  // Keep context truthful after the operation.
  if (operation === "close") {
    const remaining = (session.recentWindows ?? []).filter(
      (w) => !result.affected.some((a) => a.handle === w.handle),
    );
    patchSession({
      recentWindows: remaining,
      activeWindow: remaining[0],
      lastOpenedWindow: remaining[0],
      currentApp: remaining[0]?.application,
      lastAction: `closed ${application}`,
    });
  } else {
    const first = result.affected[0];
    rememberWindow({
      handle: first.handle,
      processId: first.processId,
      processName: first.processName,
      title: first.title,
      application,
      state: operation === "minimize" ? "minimized" : operation === "maximize" ? "maximized" : "active",
    });
    patchSession({ lastAction: `${operation} ${application}` });
  }

  const label = WINDOW_OP_LABEL[type] ?? operation;
  const pretty = application === "vscode" ? "VS Code" : application.charAt(0).toUpperCase() + application.slice(1);
  return {
    ok: true,
    title: `WINDOW ${operation.toUpperCase()}`,
    speak: `${pretty}${result.affected.length > 1 ? ` (${result.affected.length} windows)` : ""} ${label}.`,
    detail: result.affected.map((w) => w.title).join(" | "),
    data: { operation, application, affected: result.affected.length },
  };
}

async function listDirectoryAction(p: Record<string, string>): Promise<ActionResult> {
  let dir = (p.path ?? "").trim();
  if (!dir) {
    const session = getSession();
    dir = session.lastFolder?.path || session.workspaceContext?.path || scopeRoot(p.scope || "workspace");
  }
  if (dir && !isAbsoluteDescriptor(dir)) {
    const resolved = await resolveFolderDescriptor(dir);
    if (!resolved.ok || !resolved.path) {
      return { ok: false, title: "FOLDER NOT FOUND", speak: resolved.reason ?? "Folder not found.", reason: resolved.reason, action: resolved.action };
    }
    dir = resolved.path;
  }
  const abs = assertAllowedHostPath(path.resolve(dir));
  if (!(await existsDir(abs))) {
    return {
      ok: false,
      title: "FOLDER NOT FOUND",
      speak: `${path.basename(abs)} was not found.`,
      reason: `Nothing exists at ${abs}.`,
      action: "Check the path, or list drives first with `list drives`.",
    };
  }
  const entries = await fs.readdir(abs, { withFileTypes: true });
  const files = entries.filter((e) => !e.isDirectory()).map((e) => e.name);
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => `${e.name}/`);
  const lines = [...dirs.sort(), ...files.sort()].slice(0, 200);
  return {
    ok: true,
    title: "DIRECTORY",
    speak: `${path.basename(abs) || abs} has ${dirs.length} folder${dirs.length === 1 ? "" : "s"} and ${files.length} file${files.length === 1 ? "" : "s"}.`,
    detail: lines.join("\n") || "(empty)",
    data: { path: abs, folders: dirs, files },
  };
}

async function appendToFile(p: Record<string, string>): Promise<ActionResult> {
  const existing = await resolveHostFile(p, "path");
  if (!(await existsFile(existing.abs))) {
    return {
      ok: false,
      title: "FILE NOT FOUND",
      speak: `${path.basename(existing.abs)} was not found.`,
      reason: `No file exists at ${existing.abs}.`,
      action: "Create the file first, or check the path.",
    };
  }
  const before = await fs.readFile(existing.abs, "utf8").catch(() => "");
  const addition = deriveContentHint(p.text || "", existing.abs, before);
  await writeTarget(existing, before + (before.endsWith("\n") || !before ? "" : "\n") + addition + "\n");
  const after = await fs.readFile(existing.abs, "utf8");
  const verified = after === before + (before.endsWith("\n") || !before ? "" : "\n") + addition + "\n";
  return {
    ok: verified,
    title: verified ? "FILE APPENDED" : "APPEND VERIFICATION FAILED",
    speak: verified ? `Appended to ${path.basename(existing.abs)}.` : "I couldn't verify the append.",
    detail: verified ? `${path.basename(existing.abs)} is now ${after.split("\n").length} lines.` : after.slice(0, 400),
    reason: verified ? undefined : "The file content did not match the expected result after writing.",
    data: { path: existing.abs, verified },
  };
}

async function editFileAction(p: Record<string, string>, confirmed: boolean): Promise<ActionResult> {
  const target = await resolveHostFile(p, "path");
  const exists = await existsTarget(target);
  if (!exists) {
    return {
      ok: false,
      title: "FILE NOT FOUND",
      speak: `${p.path} was not found.`,
      reason: `No file exists at ${target.abs}.`,
      action: "Create the file first, or open the right project.",
    };
  }
  const before = await fs.readFile(target.abs, "utf8");
  const generated = generateCode(languageFromExtSafe(p.path), p.hint || p.path);
  const next = before.trim() ? `${before.replace(/\s*$/, "")}\n\n${generated.content}` : generated.content;
  if (before === next) {
    return { ok: true, title: "FILE UNCHANGED", speak: `${path.basename(target.abs)} is already up to date.`, detail: target.display, data: { path: target.abs } };
  }
  if (before.length > 0 && !confirmed) {
    return {
      ok: false,
      title: "OVERWRITE CONFIRMATION",
      speak: `Editing ${path.basename(target.abs)} will rewrite its contents. Confirm to continue.`,
      reason: `${path.basename(target.abs)} already has ${before.split("\n").length} lines that would be modified.`,
      action: "Confirm the edit and ask again.",
      data: { path: target.abs },
    };
  }
  await writeTarget(target, next);
  const after = await fs.readFile(target.abs, "utf8");
  const verified = after === next;
  return {
    ok: verified,
    title: verified ? "FILE EDITED" : "EDIT VERIFICATION FAILED",
    speak: verified ? `${path.basename(target.abs)} updated.` : "I couldn't verify the edit.",
    detail: verified ? `${path.basename(target.abs)} now has ${after.split("\n").length} lines.` : after.slice(0, 400),
    reason: verified ? undefined : "The file did not match the expected content after writing.",
    data: { path: target.abs, verified },
  };
}

function languageFromExtSafe(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "text";
  return ext || "text";
}

function deriveContentHint(hint: string, filePath: string, existing: string): string {
  const lower = hint.toLowerCase();
  if (/\b(heading|title)\b/.test(lower)) {
    const title = takeTitle(hint) || "Section";
    if (existing.includes(`<h1>${title}</h1>`)) return `<!-- heading already present: ${title} -->`;
    return `  <h1>${title}</h1>`;
  }
  if (/\b(login|form|input|button)\b/.test(lower) && /\.html?$/i.test(filePath)) {
    return [
      "  <form class=\"auth-form\">",
      "    <label for=\"email\">Email</label>",
      "    <input id=\"email\" name=\"email\" type=\"email\" autocomplete=\"username\" required />",
      "    <label for=\"password\">Password</label>",
      "    <input id=\"password\" name=\"password\" type=\"password\" autocomplete=\"current-password\" required />",
      "    <button type=\"submit\">Sign in</button>",
      "  </form>",
    ].join("\n");
  }
  if (/\b(paragraph|text|description|content)\b/.test(lower)) {
    return `  <p>${takeTitle(hint) || "Added content."}</p>`;
  }
  return `<!-- ${hint.trim().slice(0, 160) || "appended by MR00100"} -->`;
}

function takeTitle(hint: string): string {
  const quoted = hint.match(/["'`]([^"'`]{2,60})["'`]/);
  if (quoted) return quoted[1];
  const as = hint.match(/\b(?:as|with|for)\s+([\w ]{2,40})/i);
  return as ? as[1].trim() : "";
}

async function searchHostFiles(p: Record<string, string>): Promise<ActionResult> {
  const query = (p.query || "").trim();
  if (!query) {
    return { ok: false, title: "EMPTY QUERY", speak: "Tell me what to search for.", reason: "No search term was provided.", action: "Try `find files index.html`." };
  }
  const session = getSession();
  const root = session.lastFolder?.path || session.workspaceContext?.path || scopeRoot(p.scope || "workspace");
  const matches: string[] = [];
  const needle = query.toLowerCase();

  const walk = async (dir: string, depth: number) => {
    if (depth > 5 || matches.length >= 60) return;
    const entries = await fs
      .readdir(dir, { withFileTypes: true })
      .catch(() => [] as Array<{ name: string; isDirectory: () => boolean }>);
    for (const entry of entries) {
      if (matches.length >= 60) return;
      if (entry.name.startsWith(".") || ["node_modules", "__pycache__", "dist", "build"].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.toLowerCase().includes(needle)) matches.push(`${full}/`);
        await walk(full, depth + 1);
      } else if (entry.name.toLowerCase().includes(needle)) {
        matches.push(full);
      }
    }
  };
  await walk(path.resolve(root), 0);

  return {
    ok: true,
    title: "FILE SEARCH",
    speak: matches.length ? `Found ${matches.length} match${matches.length === 1 ? "" : "es"} for ${query}.` : `No files matching ${query} were found.`,
    detail: matches.join("\n") || "(no matches)",
    data: { query, root, matches },
  };
}

async function openVsCodeAction(p: Record<string, string>): Promise<ActionResult> {
  const session = getSession();
  let root: string;
  let targetFile: string | null = null;

  if (p.path) {
    // explicit file: resolve inside an applicable project scope (or absolute)
    const scope = p.scope && p.scope !== "workspace" ? p.scope : "vscode";
    if (isAbsoluteDescriptor(p.path)) {
      targetFile = path.resolve(p.path);
      root = path.dirname(targetFile);
    } else {
      const candidates: Array<{ scope: string }> = [
        { scope },
        { scope: "workspace" },
      ];
      let resolved: { abs: string } | null = null;
      for (const c of candidates) {
        try {
          const t = await resolveTarget(c.scope, p.path);
          const st = await fs.stat(t.abs).catch(() => null);
          if (st) {
            resolved = t;
            root = path.resolve(scopeRoot(c.scope));
            break;
          }
        } catch {
          /* try next scope */
        }
      }
      if (!resolved) {
        return {
          ok: false,
          title: "FILE NOT FOUND",
          speak: `${p.path} was not found.`,
          reason: `${p.path} does not exist in the current project (${session.workspaceContext?.path ?? scopeRoot("vscode")}) or workspace.`,
          action: "Create the file first, or open the right project and try again.",
        };
      }
      targetFile = resolved.abs;
      root = path.resolve(scopeRoot(scope));
    }
  } else if (p.folderDescriptor) {
    const resolved = await resolveFolderDescriptor(p.folderDescriptor);
    if (!resolved.ok || !resolved.path) {
      return {
        ok: false,
        title: "PROJECT NOT FOUND",
        speak: resolved.reason ?? `Could not find ${p.folderDescriptor}.`,
        reason: resolved.reason,
        action: resolved.action,
      };
    }
    root = path.resolve(resolved.path);
  } else if (p.useLast === "1") {
    if (session.lastFolder?.path) {
      root = path.resolve(session.lastFolder.path);
    } else if (session.workspaceContext?.path) {
      root = path.resolve(session.workspaceContext.path);
    } else if (session.lastFile?.path) {
      targetFile = session.lastFile.path;
      root = path.dirname(targetFile);
    } else {
      return {
        ok: false,
        title: "NO PROJECT CONTEXT",
        speak: "There is no current project or folder selected.",
        reason: "No previous folder/file context exists in this session.",
        action: "Open a folder first, then say `open it in VS Code`.",
      };
    }
  } else {
    root = path.resolve(p.scope && p.scope !== "workspace" ? scopeRoot(p.scope) : currentVsCodeWorkspace());
  }

  if (targetFile && !targetFileExists(targetFile)) {
    return {
      ok: false,
      title: "FILE NOT FOUND",
      speak: `${path.basename(targetFile)} was not found.`,
      reason: `No file exists at ${targetFile}.`,
      action: "Check the filename or create the file first.",
    };
  }

  const opened = await openVsCode(targetFile ?? root, root);
  if (opened.ok) {
    rememberFolder(root, path.basename(root));
    if (targetFile) rememberFile(targetFile, { scope: "vscode" });
    rememberWindow({
      processId: opened.pid,
      application: "vscode",
      title: targetFile ?? root,
      executablePath: opened.exe,
      openedByAssistant: true,
      openedAt: Date.now(),
      state: "active",
    });
  }
  patchSession({
    vscodeOpen: opened.ok,
    currentProject: opened.ok ? root : session.currentProject,
    workspaceContext: opened.ok ? { kind: "vscode", path: root } : session.workspaceContext,
    lastAction: opened.ok ? "opened VS Code" : session.lastAction,
  });
  const name = targetFile ? path.basename(targetFile) : p.folderDescriptor || path.basename(root) || "VS Code";
  return {
    ok: opened.ok,
    title: opened.ok ? "VS CODE" : "VS CODE UNAVAILABLE",
    speak: opened.ok
      ? targetFile
        ? `${name} opened in VS Code.`
        : p.useLast === "1" || p.folderDescriptor
          ? `${name} opened in VS Code.`
          : "VS Code opened."
      : "Visual Studio Code could not be found.",
    detail: targetFile ?? root,
    reason: opened.reason,
    action: opened.ok ? undefined : "Install VS Code or add the `code` CLI to PATH, then retry.",
    data: opened.ok ? { path: targetFile ?? root, workspace: root } : undefined,
  };
}

function targetFileExists(abs: string): boolean {
  return existsSync(abs);
}

async function createCode(p: Record<string, string>, confirmed: boolean): Promise<ActionResult> {
  const generated = generateCode(p.language || "text", p.hint || p.path || "");
  let filename = p.path || generated.filename;
  const hintAnchor = /index\.html/i.test(p.hint || "") && /login/i.test(p.hint || "");
  if (hintAnchor && (!filename || filename === generated.filename)) filename = "index.html";

  // Target root: explicit folder > explicit scope > active project context > safe fallback.
  let scope = p.scope || "";
  let rootFallback = "";
  if (p.folderDescriptor) {
    if (isAbsoluteDescriptor(p.folderDescriptor)) {
      const absDir = path.resolve(p.folderDescriptor.replace(/^~(?=[\\/])/, homeDir()));
      if (!(await existsDir(absDir))) {
        return {
          ok: false,
          title: "FOLDER NOT FOUND",
          speak: `${p.folderDescriptor} was not found.`,
          reason: `The target folder does not exist at ${absDir}.`,
          action: "Check the path, or create the folder first.",
        };
      }
      scope = "vscode";
      rootFallback = absDir;
      patchSession({ lastFolder: { path: absDir, name: path.basename(absDir) }, workspaceContext: { kind: "vscode", path: absDir } });
    } else {
      const resolved = await resolveFolderDescriptor(p.folderDescriptor);
      if (!resolved.ok || !resolved.path) {
        return {
          ok: false,
          title: "FOLDER NOT FOUND",
          speak: resolved.reason ?? `Could not find ${p.folderDescriptor}.`,
          reason: resolved.reason,
          action: resolved.action,
        };
      }
      scope = "vscode";
      rootFallback = resolved.path;
      patchSession({ lastFolder: { path: resolved.path, name: resolved.name ?? path.basename(resolved.path) }, workspaceContext: { kind: "vscode", path: resolved.path } });
    }
  }
  if (!scope) scope = "vscode";

  // "context" scope: write into the folder/project currently in focus.
  if (scope === "context" && !rootFallback) {
    const base = getSession().currentFolder || getSession().workspaceContext?.path;
    if (!base) {
      return {
        ok: false,
        title: "NO FOLDER CONTEXT",
        speak: "I'm not sure which folder you mean.",
        reason: "No active folder or project is set in this session.",
        action: "Open a folder or project first, then create the file in it.",
      };
    }
    rootFallback = base;
    scope = "vscode";
  }

  let target: Awaited<ReturnType<typeof resolveTarget>>;
  try {
    target = await resolveTarget(scope, filename);
  } catch (error) {
    return {
      ok: false,
      title: "TARGET DENIED",
      speak: "I can't write to that location.",
      reason: error instanceof Error ? error.message : "Path resolution failed.",
      action: "Choose a regular project folder instead of a protected system directory.",
    };
  }
  if (rootFallback) {
    const relCheck = path.relative(path.resolve(rootFallback), target.abs);
    if (relCheck.startsWith("..") || path.isAbsolute(relCheck)) {
      target = { ...target, abs: path.join(rootFallback, filename), display: path.join(rootFallback, filename) };
    }
  }

  const existed = await existsTarget(target);
  if (existed && !confirmed) {
    return {
      ok: false,
      title: "OVERWRITE UNKNOWN",
      speak: "Overwriting an existing file needs confirmation.",
      reason: `A file already exists at ${target.abs} and would be overwritten.`,
      action: "Confirm the overwrite and ask again.",
      data: { path: target.display },
    };
  }

  await writeTarget(target, generated.content, existed ? "w" : "wx");

  // Verify the write physically landed and matches what we generated.
  let verified = false;
  let byteLength = 0;
  let verifyReason = "";
  try {
    const written = await fs.readFile(target.abs, "utf8");
    byteLength = Buffer.byteLength(written, "utf8");
    verified = written === generated.content;
    if (!verified) verifyReason = "Content read-back did not match the generated code.";
  } catch (error) {
    verifyReason = error instanceof Error ? error.message : "Verification read failed.";
  }
  if (!verified) {
    return {
      ok: false,
      title: "WRITE VERIFICATION FAILED",
      speak: `I couldn't verify ${filename} was written correctly.`,
      detail: target.display,
      reason: verifyReason || "The written file could not be read back.",
      action: "Check filesystem permissions on the target folder and retry.",
      data: { path: target.display, absolutePath: target.abs },
    };
  }

  const root = path.resolve(rootFallback || scopeRoot(scope));
  rememberFile(target.abs, { created: !existed, modified: true, language: p.language, scope });
  rememberFolder(path.dirname(target.abs), path.basename(path.dirname(target.abs)));
  patchSession({
    lastLanguage: p.language,
    vscodeOpen: p.openVscode === "1",
    currentProject: p.openVscode === "1" ? root : getSession().currentProject,
    workspaceContext: p.openVscode === "1" ? { kind: "vscode", path: root } : getSession().workspaceContext,
    lastAction: `created ${path.basename(target.abs)}`,
  });

  if (p.openVscode === "1") {
    const vs = await openVsCode(target.abs, root);
    if (!vs.ok) {
      return {
        ok: false,
        title: "FILE SAVED — VS CODE UNAVAILABLE",
        speak: `${path.basename(target.abs)} was saved at the requested location, but Visual Studio Code could not be opened.`,
        detail: target.display,
        reason: vs.reason ?? "VS Code executor failed.",
        action: "Install VS Code or add the `code` CLI to PATH, then retry `open VS Code`.",
        data: { path: target.display, absolutePath: target.abs, fileSaved: true, verified: true },
      };
    }
  }

  // "connect it" / "link it": wire a new stylesheet or script into the active HTML file.
  let linkedInto: string | undefined;
  const wantsLink = /\b(connect|link|attach|include)\b/.test(p.hint || "");
  const ext = path.extname(target.abs).toLowerCase();
  if (wantsLink && (ext === ".css" || ext === ".js")) {
    const htmlCandidate = (getSession().recentFiles ?? []).find((f) => /\.html?$/i.test(f) && f !== target.abs);
    if (htmlCandidate && (await existsFile(htmlCandidate))) {
      const html = await fs.readFile(htmlCandidate, "utf8");
      const relHref = path.relative(path.dirname(htmlCandidate), target.abs).split(path.sep).join("/");
      const tag = ext === ".css" ? `<link rel="stylesheet" href="${relHref}" />` : `<script src="${relHref}" defer></script>`;
      if (!html.includes(relHref)) {
        const updated = /<\/head>/i.test(html)
          ? html.replace(/<\/head>/i, `  ${tag}\n</head>`)
          : `${tag}\n${html}`;
        await fs.writeFile(htmlCandidate, updated, "utf8");
        const verify = await fs.readFile(htmlCandidate, "utf8");
        if (verify.includes(relHref)) {
          linkedInto = htmlCandidate;
          rememberFile(htmlCandidate, { modified: true, scope });
        }
      } else {
        linkedInto = htmlCandidate;
      }
    }
  }

  const displayName = path.basename(target.abs);
  const speak = linkedInto
    ? `${displayName} created and linked in ${path.basename(linkedInto)}.`
    : p.openVscode === "1"
      ? `${displayName} created with the requested code and opened in VS Code.`
      : `${displayName} created and saved.`;
  return {
    ok: true,
    title: "CODE CREATED",
    speak,
    detail: target.display,
    data: { path: target.display, absolutePath: target.abs, workspace: root, fileSaved: true, verified: true, bytes: byteLength, linkedInto },
  };
}

async function runCode(p: Record<string, string>): Promise<ActionResult> {
  const session = getSession();
  const requestedCommand = (p.command || "").trim().toLowerCase();
  const requestedScript = requestedCommand.match(/^npm(?:\s+run)?\s+(dev|start|test|build)$/)?.[1];

  if (p.kind === "project" || p.kind === "test" || requestedScript) {
    const workspace = path.resolve(
      p.path
        ? path.dirname((await resolveTarget(p.scope || "vscode", p.path)).abs)
        : currentVsCodeWorkspace(),
    );
    return runProject(workspace, requestedScript ?? (p.kind === "test" ? "test" : "dev"));
  }

  let filePath: string;
  let fileDisplay: string;
  if (p.path) {
    const target = await resolveTarget(p.scope || "vscode", p.path);
    filePath = target.abs;
    fileDisplay = target.display;
  } else if (session.lastFile?.path) {
    filePath = assertAllowedHostPath(path.resolve(session.lastFile.path));
    fileDisplay = filePath;
  } else {
    return {
      ok: false,
      title: "RUN FAILED",
      speak: "No file is selected to run.",
      reason: "There is no recent file in the current workspace.",
      action: "Open or create a source file, then say `run`.",
    };
  }

  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat?.isFile()) {
    return {
      ok: false,
      title: "RUN FAILED",
      speak: "The requested file could not be found.",
      reason: `No file exists at ${filePath}.`,
      action: "Check the filename or open the intended workspace first.",
    };
  }

  // Web files "run" by opening in the real browser, not a shell.
  if (/\.(html?|svg)$/i.test(filePath)) {
    const fileUrl = pathToFileUrl(filePath);
    const launch = await openInBrowser(fileUrl);
    if (launch.ok) rememberBrowser({ browser: launch.browser, currentUrl: fileUrl, currentDomain: "file", openedByAssistant: true });
    return {
      ok: launch.ok,
      title: launch.ok ? "RUNNING IN BROWSER" : "BROWSER LAUNCH FAILED",
      speak: launch.ok ? `${path.basename(filePath)} is running in the browser.` : "I couldn't open the page in a browser.",
      detail: fileUrl,
      reason: launch.reason,
      data: { url: fileUrl, browser: launch.browser, file: fileDisplay },
    };
  }

  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "mr00100-run-"));
  try {
    const plan = runPlanFor(filePath, tempDirectory);
    if (!plan) {
      return {
        ok: false,
        title: "RUNNER UNAVAILABLE",
        speak: `I don't have a safe runner configured for ${path.extname(filePath)} files.`,
        reason: `No direct argument-vector runner is configured for ${path.extname(filePath) || "this file type"}.`,
        action: "Install/configure the language runtime, or run it from the integrated terminal after reviewing the command.",
      };
    }

    let output = "";
    let exitCode: number | null = 0;
    let lastCommand = "";
    for (let index = 0; index < plan.steps.length; index++) {
      const step = plan.steps[index];
      let executable = path.isAbsolute(step.program) ? step.program : await findExecutable(step.program);

      if (!executable && filePath.toLowerCase().endsWith(".py")) {
        const pythonFallback = process.platform === "win32" ? "python.exe" : "python";
        executable = await findExecutable(pythonFallback);
      }
      if (!executable) {
        exitCode = null;
        output += `${step.label}: executable not found on PATH.\n`;
        break;
      }

      lastCommand = `${step.label} (cwd: ${path.dirname(filePath)})`;
      const result = await execCapture(executable, step.args, 120_000, path.dirname(filePath));
      output += `${result.stdout}${result.stderr}`;
      exitCode = result.exitCode;
      if (!result.ok) break;
      if (index < plan.steps.length - 1) output += `\n[MR00100] ${step.label} succeeded.\n`;
    }

    const succeeded = exitCode === 0;
    patchSession({ lastRun: { command: lastCommand, cwd: path.dirname(filePath) } });
    const terminalResult = {
      command: lastCommand,
      cwd: path.dirname(filePath),
      output: output.slice(0, 8000),
      exitCode,
      ok: succeeded,
    };
    return {
      ok: succeeded,
      title: succeeded ? "PROGRAM EXECUTED" : "PROGRAM FAILED",
      speak: succeeded ? "Program executed successfully." : "Program execution failed. See the terminal output for details.",
      detail: output.slice(0, 1500),
      reason: succeeded ? undefined : output.slice(-600) || "The process exited unsuccessfully.",
      action: succeeded ? undefined : "Check the terminal output and verify the required runtime/compiler is installed.",
      data: { terminalResult, file: fileDisplay },
    };
  } finally {
    await fs.rm(tempDirectory, { recursive: true, force: true }).catch(() => null);
  }
}

async function runProject(workspace: string, requestedScript: string): Promise<ActionResult> {
  const allowedScripts = new Set(["dev", "start", "test", "build"]);
  if (!allowedScripts.has(requestedScript)) {
    return {
      ok: false,
      title: "PROJECT SCRIPT BLOCKED",
      speak: "That project script is not on the allowed run list.",
      reason: `Script "${requestedScript}" is not in the allowed npm script set.`,
      action: "Choose dev, start, test, or build explicitly.",
    };
  }
  const root = assertAllowedHostPath(path.resolve(workspace));
  const manifestPath = path.join(root, "package.json");
  let manifest: { scripts?: Record<string, string> };
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as { scripts?: Record<string, string> };
  } catch (error) {
    return {
      ok: false,
      title: "PROJECT MANIFEST UNAVAILABLE",
      speak: "I couldn't read the project package manifest.",
      reason: error instanceof Error ? error.message : `No package.json at ${manifestPath}.`,
      action: "Open the intended project folder or provide a package.json.",
    };
  }
  if (!manifest.scripts?.[requestedScript]) {
    return {
      ok: false,
      title: "PROJECT SCRIPT NOT FOUND",
      speak: `The project does not define an npm ${requestedScript} script.`,
      reason: `package.json is missing scripts.${requestedScript}.`,
      action: "Check package.json scripts or choose another project command.",
    };
  }

  const npm = await findExecutable(process.platform === "win32" ? "npm.cmd" : "npm");
  if (!npm) {
    return {
      ok: false,
      title: "NPM NOT FOUND",
      speak: "I couldn't find npm on this computer.",
      reason: "npm CLI was not found on PATH.",
      action: "Install Node.js/npm or add it to PATH, then retry.",
    };
  }

  const result = process.platform === "win32" && /\.(cmd|bat)$/i.test(npm)
    ? await execCapture("cmd.exe", ["/d", "/s", "/c", `call "${npm}" run ${requestedScript}`], 120_000, root)
    : await execCapture(npm, ["run", requestedScript], 120_000, root);
  const terminalResult = {
    command: `npm run ${requestedScript}`,
    cwd: root,
    output: `${result.stdout}${result.stderr}`.slice(0, 8000),
    exitCode: result.exitCode,
    ok: result.ok,
  };
  patchSession({ lastRun: { command: terminalResult.command, cwd: root } });
  return {
    ok: result.ok,
    title: result.ok ? "PROJECT EXECUTED" : "PROJECT FAILED",
    speak: result.ok ? "Project command completed successfully." : "Project command failed. See terminal output for details.",
    detail: terminalResult.output.slice(0, 1500),
    reason: result.ok ? undefined : terminalResult.output.slice(-600) || "npm returned a non-zero exit code.",
    action: result.ok ? undefined : "Review the terminal output, then retry after fixing the reported issue.",
    data: { terminalResult },
  };
}

function pretty(value: string) {
  if (!value) return "Item";
  if (value.toLowerCase() === "vscode") return "VS Code";
  return value.charAt(0).toUpperCase() + value.slice(1);
}
