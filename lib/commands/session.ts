import type { WorkspaceContext } from "./types";

export type WindowContext = {
  handle?: string;
  processId?: number;
  processName?: string;
  executablePath?: string;
  title?: string;
  application?: string;
  state?: "active" | "minimized" | "maximized" | "normal";
  openedByAssistant?: boolean;
  openedAt?: number;
};

export type BrowserContext = {
  browser?: string;
  windowId?: string;
  tabId?: string;
  currentUrl?: string;
  currentDomain?: string;
  currentTitle?: string;
  openedByAssistant?: boolean;
};

/**
 * Compact structured context. Deliberately small: only what is needed to
 * resolve pronouns ("this", "isko", "usme") and chain multi-step tasks.
 * Never holds secrets or full conversation transcripts.
 */
export type CommandSession = {
  // Application / window
  currentApp?: string;
  activeWindow?: WindowContext;
  lastOpenedWindow?: WindowContext;
  recentWindows?: WindowContext[];

  // Browser
  browser?: BrowserContext;

  // Filesystem
  currentDrive?: string;
  currentFolder?: string;
  currentFile?: string;
  lastCreatedFile?: string;
  lastCreatedFolder?: string;
  lastModifiedFile?: string;
  recentFolders?: string[];
  recentFiles?: string[];

  // Project / editor
  workspaceContext?: WorkspaceContext;
  currentProject?: string;
  lastLanguage?: string;
  vscodeOpen?: boolean;

  // Task tracking
  lastCommand?: string;
  lastAction?: string;
  lastTargetKind?: "window" | "tab" | "file" | "folder" | "app" | "settings";
  lastQuery?: string;
  lastApp?: string;
  lastRun?: { command: string; cwd?: string };

  // Legacy field retained for existing callers.
  lastFile?: { path: string; scope: string; language?: string };
  lastFolder?: { path: string; name: string };
};

const MAX_RECENT = 8;

const g = globalThis as typeof globalThis & { __mr00100Session?: CommandSession };

export function getSession(): CommandSession {
  g.__mr00100Session ??= {};
  return g.__mr00100Session;
}

export function patchSession(patch: Partial<CommandSession>): CommandSession {
  const next = { ...getSession(), ...patch };
  g.__mr00100Session = next;
  return next;
}

/** Record a real window MR00100 just opened, keeping a bounded history. */
export function rememberWindow(window: WindowContext): CommandSession {
  const session = getSession();
  const recent = [window, ...(session.recentWindows ?? []).filter((w) => w.handle !== window.handle || w.application !== window.application)];
  return patchSession({
    activeWindow: window,
    lastOpenedWindow: window,
    currentApp: window.application ?? session.currentApp,
    recentWindows: recent.slice(0, MAX_RECENT),
    lastTargetKind: "window",
  });
}

export function rememberFolder(folderPath: string, name?: string): CommandSession {
  const session = getSession();
  const recentFolders = [folderPath, ...(session.recentFolders ?? []).filter((f) => f !== folderPath)];
  const drive = /^([A-Za-z]:)/.exec(folderPath)?.[1];
  return patchSession({
    currentFolder: folderPath,
    lastFolder: { path: folderPath, name: name ?? folderPath },
    currentDrive: drive ? `${drive}\\` : session.currentDrive,
    recentFolders: recentFolders.slice(0, MAX_RECENT),
    lastTargetKind: "folder",
  });
}

export function rememberFile(filePath: string, opts: { created?: boolean; modified?: boolean; language?: string; scope?: string } = {}): CommandSession {
  const session = getSession();
  const recentFiles = [filePath, ...(session.recentFiles ?? []).filter((f) => f !== filePath)];
  return patchSession({
    currentFile: filePath,
    lastFile: { path: filePath, scope: opts.scope ?? "host", language: opts.language },
    lastCreatedFile: opts.created ? filePath : session.lastCreatedFile,
    lastModifiedFile: opts.modified || opts.created ? filePath : session.lastModifiedFile,
    recentFiles: recentFiles.slice(0, MAX_RECENT),
    lastTargetKind: "file",
  });
}

export function rememberBrowser(context: BrowserContext): CommandSession {
  const session = getSession();
  return patchSession({
    browser: { ...session.browser, ...context },
    lastTargetKind: "tab",
  });
}

/** Compact snapshot used for prompt context and the UI — never the whole history. */
export function contextSnapshot(): Record<string, string | undefined> {
  const s = getSession();
  return {
    app: s.currentApp,
    window: s.activeWindow?.title ?? s.activeWindow?.application,
    browserDomain: s.browser?.currentDomain,
    drive: s.currentDrive,
    folder: s.currentFolder,
    file: s.currentFile,
    project: s.workspaceContext?.path,
    lastAction: s.lastAction,
  };
}
