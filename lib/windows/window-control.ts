import { execCapture } from "./shell";

/**
 * Real Windows window control.
 *
 * Windows are enumerated through the .NET process table (MainWindowHandle),
 * and manipulated with user32.dll. Closing uses CloseMainWindow() — the
 * graceful WM_CLOSE path — so applications can prompt to save. Processes are
 * never force-killed unless the caller explicitly opts in.
 */

export type WindowInfo = {
  handle: string;
  processId: number;
  processName: string;
  title: string;
  executablePath?: string;
};

export type WindowActionResult = {
  ok: boolean;
  affected: WindowInfo[];
  speak?: string;
  reason?: string;
  action?: string;
  ambiguous?: WindowInfo[];
};

const WINDOWS_ONLY = "Window control requires Windows.";

/** Never target these — closing them destabilises the desktop shell. */
const PROTECTED_PROCESSES = new Set([
  "csrss",
  "wininit",
  "winlogon",
  "services",
  "lsass",
  "smss",
  "dwm",
  "system",
  "svchost",
  "fontdrvhost",
  "sihost",
  "ctfmon",
]);

/** Map spoken application names to real Windows process names. */
const PROCESS_ALIASES: Record<string, string[]> = {
  explorer: ["explorer"],
  "file explorer": ["explorer"],
  "windows explorer": ["explorer"],
  chrome: ["chrome"],
  "google chrome": ["chrome"],
  browser: ["chrome", "msedge", "firefox"],
  edge: ["msedge"],
  firefox: ["firefox"],
  vscode: ["Code", "Code - Insiders"],
  "vs code": ["Code", "Code - Insiders"],
  "visual studio code": ["Code", "Code - Insiders"],
  code: ["Code", "Code - Insiders"],
  notepad: ["notepad"],
  calculator: ["CalculatorApp", "Calculator"],
  settings: ["SystemSettings", "ApplicationFrameHost"],
  "windows settings": ["SystemSettings", "ApplicationFrameHost"],
  terminal: ["WindowsTerminal", "cmd", "powershell"],
  "windows terminal": ["WindowsTerminal"],
  cmd: ["cmd"],
  "command prompt": ["cmd"],
  powershell: ["powershell", "pwsh"],
  "task manager": ["Taskmgr"],
  spotify: ["Spotify"],
  discord: ["Discord"],
  word: ["WINWORD"],
  excel: ["EXCEL"],
  paint: ["mspaint"],
  "recycle bin": ["explorer"],
};

export function processNamesFor(application: string): string[] {
  const key = application.trim().toLowerCase().replace(/\s+/g, " ");
  if (PROCESS_ALIASES[key]) return PROCESS_ALIASES[key];
  const partial = Object.keys(PROCESS_ALIASES).find((alias) => key.includes(alias) || alias.includes(key));
  if (partial) return PROCESS_ALIASES[partial];
  return [application.replace(/\.exe$/i, "")];
}

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Enumerate every top-level window that currently has a title bar. */
export async function listWindows(): Promise<WindowInfo[]> {
  if (process.platform !== "win32") return [];
  const script = [
    "$ErrorActionPreference='SilentlyContinue'",
    "Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -ne '' } |",
    "Select-Object @{N='handle';E={[string]$_.MainWindowHandle}},",
    "@{N='processId';E={$_.Id}},",
    "@{N='processName';E={$_.ProcessName}},",
    "@{N='title';E={$_.MainWindowTitle}},",
    "@{N='executablePath';E={$_.Path}} | ConvertTo-Json -Compress -Depth 3",
  ].join(" ");
  const result = await execCapture("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], 12_000);
  if (!result.ok || !result.stdout.trim()) return [];
  try {
    const parsed = JSON.parse(result.stdout.trim()) as WindowInfo | WindowInfo[];
    const windows = Array.isArray(parsed) ? parsed : [parsed];
    return windows.filter((w) => w && w.handle && !PROTECTED_PROCESSES.has((w.processName ?? "").toLowerCase()));
  } catch {
    return [];
  }
}

export type WindowMatch = {
  application?: string;
  processId?: number;
  handle?: string;
  /** Substring matched against the window title (e.g. a folder name or domain). */
  titleContains?: string;
};

export async function findWindows(match: WindowMatch): Promise<WindowInfo[]> {
  const all = await listWindows();
  let candidates = all;

  if (match.handle) candidates = candidates.filter((w) => w.handle === match.handle);
  if (match.processId) candidates = candidates.filter((w) => w.processId === match.processId);
  if (match.application) {
    const names = processNamesFor(match.application).map((n) => n.toLowerCase());
    candidates = candidates.filter((w) => names.includes((w.processName ?? "").toLowerCase()));
  }
  if (match.titleContains) {
    const needle = match.titleContains.toLowerCase();
    const titled = candidates.filter((w) => (w.title ?? "").toLowerCase().includes(needle));
    // Only narrow by title when it actually matches something.
    if (titled.length) candidates = titled;
  }
  return candidates;
}

type Operation = "close" | "minimize" | "maximize" | "restore" | "focus";

const SHOW_WINDOW_FLAGS: Record<Exclude<Operation, "close">, number> = {
  minimize: 6, // SW_MINIMIZE
  maximize: 3, // SW_MAXIMIZE
  restore: 9, // SW_RESTORE
  focus: 5, // SW_SHOW
};

/**
 * Apply a window operation to specific handles and verify the result by
 * re-enumerating windows afterwards.
 */
export async function applyWindowOperation(
  operation: Operation,
  targets: WindowInfo[],
): Promise<WindowActionResult> {
  if (process.platform !== "win32") {
    return { ok: false, affected: [], reason: WINDOWS_ONLY, action: "Run MR00100 on your Windows computer." };
  }
  if (!targets.length) {
    return { ok: false, affected: [], reason: "No matching window was found.", action: "Open the application first." };
  }

  const ids = targets.map((t) => t.processId).join(",");
  const handles = targets.map((t) => t.handle).join(",");

  const script =
    operation === "close"
      ? [
          "$ErrorActionPreference='SilentlyContinue'",
          `$ids = @(${ids})`,
          "$closed = 0",
          "foreach ($id in $ids) {",
          "  $p = Get-Process -Id $id -ErrorAction SilentlyContinue",
          "  if ($p) { if ($p.CloseMainWindow()) { $closed++ } }",
          "}",
          "Write-Output ('CLOSED=' + $closed)",
        ].join("; ")
      : [
          "$ErrorActionPreference='SilentlyContinue'",
          "Add-Type @'",
          "using System;",
          "using System.Runtime.InteropServices;",
          "public class MR00100Win {",
          "  [DllImport(\"user32.dll\")] public static extern bool ShowWindow(IntPtr h, int n);",
          "  [DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr h);",
          "}",
          "'@",
          `$handles = @(${handles})`,
          `$flag = ${SHOW_WINDOW_FLAGS[operation]}`,
          "$done = 0",
          "foreach ($h in $handles) {",
          "  $ptr = [IntPtr]::new([int64]$h)",
          "  if ([MR00100Win]::ShowWindow($ptr, $flag)) { $done++ }",
          operation === "focus" ? "  [void][MR00100Win]::SetForegroundWindow($ptr)" : "",
          "}",
          "Write-Output ('DONE=' + $done)",
        ]
          .filter(Boolean)
          .join("; ");

  const result = await execCapture("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], 20_000);
  if (!result.ok) {
    return {
      ok: false,
      affected: [],
      reason: result.stderr || "The window operation could not be executed.",
      action: "Perform the action manually in Windows.",
    };
  }

  if (operation === "close") {
    // Verify by re-enumerating: the handles must be gone.
    await new Promise((resolve) => setTimeout(resolve, 900));
    const remaining = await listWindows();
    const stillOpen = targets.filter((t) => remaining.some((w) => w.handle === t.handle));
    const closed = targets.filter((t) => !stillOpen.some((s) => s.handle === t.handle));
    if (!closed.length) {
      return {
        ok: false,
        affected: [],
        reason: "The application did not close. It may be showing an unsaved-changes prompt.",
        action: "Check the application window and respond to any save prompt.",
      };
    }
    return { ok: true, affected: closed };
  }

  const done = /DONE=(\d+)/.exec(result.stdout);
  const count = done ? Number(done[1]) : 0;
  if (count === 0) {
    return {
      ok: false,
      affected: [],
      reason: `Windows reported no window changed state for ${operation}.`,
      action: "The window may already be in that state.",
    };
  }
  return { ok: true, affected: targets.slice(0, count) };
}

/** Graceful close with optional force escalation (never used by default). */
export async function closeApplicationWindows(
  application: string,
  options: { titleContains?: string; all?: boolean } = {},
): Promise<WindowActionResult> {
  const matches = await findWindows({ application, titleContains: options.titleContains });
  if (!matches.length) {
    return {
      ok: false,
      affected: [],
      reason: `No open ${application} window was found.`,
      action: `${application} does not appear to be running.`,
    };
  }
  const targets = options.all ? matches : [matches[0]];
  return applyWindowOperation("close", targets);
}
