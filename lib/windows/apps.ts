import { promises as fs } from "node:fs";
import path from "node:path";
import { execCapture, openWithOs, spawnDetachedChecked } from "./shell";
import { homeDir } from "./paths";

export type AppAlias = {
  id: string;
  names: string[];
  win: string[];
  common: string[];
  web?: string;
  process?: string;
};

export const APP_CATALOG: AppAlias[] = [
  {
    id: "chrome",
    names: ["chrome", "google chrome", "googlechrome", "browser"],
    win: ["chrome.exe", "chrome"],
    common: [
      "Google\\Chrome\\Application\\chrome.exe",
      "Google\\Chrome\\Application\\chrome.exe",
    ],
    process: "chrome.exe",
    web: "https://www.google.com",
  },
  {
    id: "edge",
    names: ["edge", "microsoft edge", "msedge"],
    win: ["msedge.exe", "msedge"],
    common: ["Microsoft\\Edge\\Application\\msedge.exe"],
    process: "msedge.exe",
  },
  {
    id: "firefox",
    names: ["firefox", "mozilla firefox"],
    win: ["firefox.exe", "firefox"],
    common: ["Mozilla Firefox\\firefox.exe"],
    process: "firefox.exe",
  },
  {
    id: "vscode",
    names: ["vscode", "vs code", "visual studio code", "code"],
    win: ["code.cmd", "code.exe", "code"],
    common: [
      "Microsoft VS Code\\bin\\code.cmd",
      "Microsoft VS Code\\Code.exe",
      "Programs\\Microsoft VS Code\\bin\\code.cmd",
      "Programs\\Microsoft VS Code\\Code.exe",
    ],
    process: "Code.exe",
  },
  {
    id: "explorer",
    names: ["file explorer", "windows explorer", "explorer", "files explorer"],
    win: ["explorer.exe"],
    common: [],
    process: "explorer.exe",
  },
  {
    id: "calculator",
    names: ["calculator", "calc"],
    win: ["calc.exe", "calc"],
    common: [],
    process: "Calculator.exe",
  },
  {
    id: "notepad",
    names: ["notepad"],
    win: ["notepad.exe", "notepad"],
    common: [],
    process: "notepad.exe",
  },
  {
    id: "cmd",
    names: ["command prompt", "cmd", "command prompt cmd"],
    win: ["cmd.exe"],
    common: [],
    process: "cmd.exe",
  },
  {
    id: "powershell",
    names: ["powershell", "windows powershell", "pwsh"],
    win: ["powershell.exe", "pwsh.exe", "pwsh"],
    common: [],
    process: "powershell.exe",
  },
  {
    id: "spotify",
    names: ["spotify"],
    win: ["spotify.exe", "spotify"],
    common: ["Spotify\\Spotify.exe"],
    web: "https://open.spotify.com",
    process: "Spotify.exe",
  },
  {
    id: "whatsapp",
    names: ["whatsapp", "whats app"],
    win: ["WhatsApp.exe", "whatsapp"],
    common: ["WindowsApps\\whatsapp.exe"],
    web: "https://web.whatsapp.com",
    process: "WhatsApp.exe",
  },
  {
    id: "discord",
    names: ["discord"],
    win: ["Discord.exe", "discord"],
    common: ["Discord\\Update.exe"],
    web: "https://discord.com/app",
    process: "Discord.exe",
  },
  {
    id: "youtube",
    names: ["youtube"],
    win: ["YouTube.exe"],
    common: [],
    web: "https://www.youtube.com",
  },
  {
    id: "word",
    names: ["word", "microsoft word"],
    win: ["winword.exe"],
    common: ["Microsoft Office\\root\\Office16\\WINWORD.EXE"],
    web: "https://www.office.com/launch/word",
  },
  {
    id: "excel",
    names: ["excel", "microsoft excel"],
    win: ["excel.exe"],
    common: ["Microsoft Office\\root\\Office16\\EXCEL.EXE"],
    web: "https://www.office.com/launch/excel",
  },
  {
    id: "outlook",
    names: ["outlook", "microsoft outlook"],
    win: ["outlook.exe"],
    common: ["Microsoft Office\\root\\Office16\\OUTLOOK.EXE"],
    web: "https://outlook.office.com",
  },
  {
    id: "taskmanager",
    names: ["task manager"],
    win: ["taskmgr.exe"],
    common: [],
  },
  {
    id: "controlpanel",
    names: ["control panel"],
    win: ["control.exe"],
    common: [],
  },
  {
    id: "registry",
    names: ["registry editor", "regedit"],
    win: ["regedit.exe"],
    common: [],
  },
  {
    id: "paint",
    names: ["paint", "ms paint"],
    win: ["mspaint.exe"],
    common: [],
  },
  {
    id: "snippingtool",
    names: ["snipping tool", "snip"],
    win: ["SnippingTool.exe"],
    common: [],
  },
];

const cache = new Map<string, { found: boolean; exe?: string; t: number }>();

function candidateDirs() {
  const dirs: string[] = [];
  const pf = process.env.ProgramFiles;
  const pf86 = process.env["ProgramFiles(x86)"];
  const local = process.env.LOCALAPPDATA;
  const home = homeDir();
  if (pf) dirs.push(pf);
  if (pf86) dirs.push(pf86);
  if (local) {
    dirs.push(local);
    dirs.push(path.join(local, "Programs"));
  }
  dirs.push(path.join(home, "AppData", "Local"));
  dirs.push(path.join(home, "AppData", "Local", "Programs"));
  return dirs;
}

async function fileExists(p: string) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function lookupWhere(bin: string): Promise<string | null> {
  const tool = process.platform === "win32" ? "where.exe" : "which";
  const res = await execCapture(tool, [bin], 2500);
  if (!res.ok) return null;
  const line = res.stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l && !l.toLowerCase().includes("info:"));
  return line || null;
}

async function lookupShortcut(query: string): Promise<string | null> {
  if (process.platform !== "win32") return null;
  const safe = query.replace(/[^a-zA-Z0-9 _-]/g, "");
  const script = [
    "$ErrorActionPreference='SilentlyContinue'",
    "$roots = @([Environment]::GetFolderPath('StartMenu'), [Environment]::GetFolderPath('CommonStartMenu'))",
    `Get-ChildItem -Path $roots -Filter '*${safe}*.lnk' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName`,
  ].join("; ");
  const res = await execCapture("powershell.exe", ["-NoProfile", "-Command", script], 5000);
  const line = res.stdout.trim().split(/\r?\n/).find((l) => l.endsWith(".lnk"));
  return line || null;
}

export function matchCatalog(raw: string): AppAlias | null {
  const key = raw.trim().toLowerCase().replace(/\s+/g, " ");
  return (
    APP_CATALOG.find((a) => a.id === key || a.names.some((n) => n === key)) ??
    APP_CATALOG.find((a) => a.names.some((n) => key.includes(n) || n.includes(key))) ??
    null
  );
}

export async function resolveApp(raw: string): Promise<{
  found: boolean;
  id: string;
  exe?: string;
  web?: string;
  display: string;
}> {
  const catalog = matchCatalog(raw);
  const id = catalog?.id ?? raw.trim().toLowerCase();
  const display = catalog?.id ?? raw.trim();
  const cached = cache.get(id);
  if (cached && Date.now() - cached.t < 60_000) {
    return { found: cached.found, id, exe: cached.exe, web: catalog?.web, display };
  }

  const bins = catalog?.win ?? [raw];
  for (const bin of bins) {
    const located = await lookupWhere(bin);
    if (located) {
      cache.set(id, { found: true, exe: located, t: Date.now() });
      return { found: true, id, exe: located, web: catalog?.web, display };
    }
  }

  if (catalog) {
    for (const rel of catalog.common) {
      for (const root of candidateDirs()) {
        const full = path.join(root, rel);
        if (await fileExists(full)) {
          cache.set(id, { found: true, exe: full, t: Date.now() });
          return { found: true, id, exe: full, web: catalog.web, display };
        }
      }
    }
    const shortcut = await lookupShortcut(catalog.names[0] ?? catalog.id);
    if (shortcut) {
      cache.set(id, { found: true, exe: shortcut, t: Date.now() });
      return { found: true, id, exe: shortcut, web: catalog.web, display };
    }
  }

  cache.set(id, { found: false, t: Date.now() });
  return { found: false, id, web: catalog?.web, display };
}

export async function launchResolved(exe: string, args: string[] = []): Promise<{ pid: number }> {
  if (process.platform === "win32" && (/\.lnk$/i.test(exe) || /\.url$/i.test(exe))) {
    const pid = await spawnDetachedChecked("explorer.exe", [exe, ...args]);
    return { pid };
  }
  const pid = await spawnDetachedChecked(exe, args);
  return { pid };
}

export function launchFallbackSearch(query: string) {
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  openWithOs(url);
  return url;
}

export async function closeProcess(name: string) {
  const catalog = matchCatalog(name);
  const image = catalog?.process ?? (name.endsWith(".exe") ? name : `${name}.exe`);
  if (process.platform === "win32") {
    return execCapture("taskkill.exe", ["/IM", image, "/T"], 5000);
  }
  return execCapture("pkill", ["-f", catalog?.id ?? name], 5000);
}
