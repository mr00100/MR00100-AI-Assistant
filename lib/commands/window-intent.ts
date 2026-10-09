import type { DesktopAction } from "./types";

/**
 * Universal window/close router.
 *
 * Resolves natural phrasing (English, Roman Urdu and normalized Urdu) into a
 * precise target: a browser tab, a browser window, a named application window,
 * or the contextual "this" window. The executor performs the real action.
 */

const OPERATIONS: Array<{ re: RegExp; op: "close" | "minimize" | "maximize" | "restore" | "focus" }> = [
  { re: /\b(close|quit|exit|shut)\b/, op: "close" },
  { re: /\bminimi[sz]e\b/, op: "minimize" },
  { re: /\bmaximi[sz]e\b/, op: "maximize" },
  { re: /\brestore\b/, op: "restore" },
  { re: /\b(focus|switch to|bring .* (to )?(front|forward)|go to)\b/, op: "focus" },
];

const ACTION_TYPE = {
  close: "win.window.close",
  minimize: "win.window.minimize",
  maximize: "win.window.maximize",
  restore: "win.window.restore",
  focus: "win.window.focus",
} as const;

const APP_WORDS: Array<{ re: RegExp; app: string }> = [
  { re: /\b(file explorer|windows explorer|explorer)\b/, app: "explorer" },
  { re: /\b(vs ?code|visual studio code)\b/, app: "vscode" },
  { re: /\b(google chrome|chrome)\b/, app: "chrome" },
  { re: /\b(microsoft edge|edge)\b/, app: "edge" },
  { re: /\bfirefox\b/, app: "firefox" },
  { re: /\bnotepad\b/, app: "notepad" },
  { re: /\bcalculator\b/, app: "calculator" },
  { re: /\b(windows settings|settings)\b/, app: "settings" },
  { re: /\b(windows terminal|terminal)\b/, app: "terminal" },
  { re: /\b(command prompt|cmd)\b/, app: "cmd" },
  { re: /\bpowershell\b/, app: "powershell" },
  { re: /\btask manager\b/, app: "task manager" },
  { re: /\bspotify\b/, app: "spotify" },
  { re: /\bdiscord\b/, app: "discord" },
  { re: /\bword\b/, app: "word" },
  { re: /\bexcel\b/, app: "excel" },
  { re: /\bpaint\b/, app: "paint" },
  { re: /\brecycle bin\b/, app: "recycle bin" },
];

const CONTEXTUAL = /\b(this|that|it|current|active)\b/;

/** Detect "close all X windows" versus a single window. */
function wantsAll(text: string): boolean {
  return /\ball\b/.test(text) || /\bsaare|sari|sab\b/.test(text);
}

export function parseWindowIntent(text: string): DesktopAction[] | null {
  const t = text.trim();
  if (!t) return null;

  const operation = OPERATIONS.find((o) => o.re.test(t));
  if (!operation) return null;

  // "close" must not hijack file/folder deletion or app launching.
  if (/\b(delete|remove|create|make|write|save|run|play|search)\b/.test(t)) return null;

  const isTab = /\btabs?\b/.test(t);
  const isWindowWord = /\bwindows?\b/.test(t);
  const all = wantsAll(t);

  // ---- browser tab scope -------------------------------------------------
  if (isTab && operation.op === "close") {
    return [{ type: "browser.tab.close", params: { all: all ? "1" : "0" } }];
  }

  const appHit = APP_WORDS.find((a) => a.re.test(t));

  // ---- browser window scope ---------------------------------------------
  if (appHit && ["chrome", "edge", "firefox"].includes(appHit.app) && operation.op === "close") {
    // "close YouTube" style site names are handled by the tab path below.
    return [
      {
        type: "browser.window.close",
        params: { application: appHit.app, all: all ? "1" : "0" },
      },
    ];
  }

  // ---- named application window -----------------------------------------
  if (appHit) {
    return [
      {
        type: ACTION_TYPE[operation.op],
        params: { application: appHit.app, all: all ? "1" : "0" },
      },
    ];
  }

  // ---- a website name means the browser tab showing it -------------------
  const siteHit = /\b(youtube|github|filecr|google|facebook|gmail|reddit|stackoverflow|chatgpt)\b/.exec(t);
  if (siteHit && operation.op === "close") {
    return [{ type: "browser.tab.close", params: { site: siteHit[1], all: "0" } }];
  }

  // ---- contextual "this / it / isko" -------------------------------------
  if (CONTEXTUAL.test(t) || isWindowWord) {
    return [
      {
        type: ACTION_TYPE[operation.op],
        params: { contextual: "1", all: all ? "1" : "0" },
      },
    ];
  }

  // A drive/folder reference: close the Explorer window showing it.
  const driveHit = /\b([a-z])\s*drive\b/.exec(t);
  if (driveHit && operation.op === "close") {
    return [
      {
        type: "win.window.close",
        params: { application: "explorer", titleContains: `${driveHit[1].toUpperCase()}:`, all: all ? "1" : "0" },
      },
    ];
  }

  // Bare operation verb with no target: act on the active window.
  if (/^\s*(close|minimi[sz]e|maximi[sz]e|restore|focus)\s*$/.test(t)) {
    return [{ type: ACTION_TYPE[operation.op], params: { contextual: "1", all: "0" } }];
  }

  return null;
}

export function isWindowListQuery(text: string): boolean {
  return /\b(what|which|list|show)\b.*\b(windows?|apps? (are )?open|running (apps?|windows?))\b/.test(text);
}
