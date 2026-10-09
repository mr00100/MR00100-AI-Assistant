import { spawn, exec } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  ensureWorkspace,
  listDir,
  readFileSafe,
  recentFiles,
  resolveSafe,
  searchWorkspace,
  toRelative,
  workspaceRoot,
  WorkspaceError,
} from "./workspace";
import { collectTelemetry } from "./telemetry";

const execAsync = promisify(exec);

export type ToolResult = {
  ok: boolean;
  title: string;
  speak: string;
  detail?: string;
  data?: unknown;
  reason?: string;
  action?: string;
};

const clipboardFallback = globalThis as typeof globalThis & {
  __mr00100Clipboard?: string;
};

/* ------------------------------------------------------------------ apps */

const APP_MAP: Record<string, { win: string; darwin: string; linux: string }> = {
  chrome: { win: "chrome", darwin: "Google Chrome", linux: "google-chrome" },
  firefox: { win: "firefox", darwin: "Firefox", linux: "firefox" },
  edge: { win: "msedge", darwin: "Microsoft Edge", linux: "microsoft-edge" },
  code: { win: "code", darwin: "Visual Studio Code", linux: "code" },
  "vs code": { win: "code", darwin: "Visual Studio Code", linux: "code" },
  vscode: { win: "code", darwin: "Visual Studio Code", linux: "code" },
  notepad: { win: "notepad", darwin: "TextEdit", linux: "gedit" },
  calculator: { win: "calc", darwin: "Calculator", linux: "gnome-calculator" },
  calc: { win: "calc", darwin: "Calculator", linux: "gnome-calculator" },
  terminal: { win: "wt", darwin: "Terminal", linux: "gnome-terminal" },
  explorer: { win: "explorer", darwin: "Finder", linux: "nautilus" },
  spotify: { win: "spotify", darwin: "Spotify", linux: "spotify" },
  discord: { win: "discord", darwin: "Discord", linux: "discord" },
};

export async function launchApp(appRaw: string): Promise<ToolResult> {
  const app = appRaw.trim().toLowerCase();
  const mapped = APP_MAP[app];
  const platform = process.platform;
  const target =
    platform === "win32"
      ? (mapped?.win ?? app)
      : platform === "darwin"
        ? (mapped?.darwin ?? app)
        : (mapped?.linux ?? app);

  try {
    if (platform === "win32") {
      spawn("cmd", ["/c", "start", "", target], { detached: true, stdio: "ignore" }).unref();
    } else if (platform === "darwin") {
      spawn("open", ["-a", target], { detached: true, stdio: "ignore" }).unref();
    } else {
      await execAsync(`command -v ${JSON.stringify(target).replace(/"/g, "")}`, { timeout: 2500 });
      spawn(target, [], { detached: true, stdio: "ignore" }).unref();
    }
    return {
      ok: true,
      title: `LAUNCH ${target.toUpperCase()}`,
      speak: `Launching ${appRaw}.`,
      detail: `Spawned "${target}" on ${platform}.`,
    };
  } catch (error) {
    return {
      ok: false,
      title: `LAUNCH FAILED — ${target}`,
      speak: `I could not launch ${appRaw} on this host.`,
      reason:
        error instanceof Error
          ? `Executable "${target}" was not found or is not permitted on ${platform}.`
          : "Unknown spawn failure",
      action:
        "Install the application or map a different executable name, then retry. The MR00100 host process must run on your own desktop for launch control.",
    };
  }
}

export async function closeApp(appRaw: string): Promise<ToolResult> {
  const app = appRaw.trim();
  try {
    if (process.platform === "win32") {
      await execAsync(`taskkill /IM ${app}.exe /T`, { timeout: 5000 });
    } else {
      await execAsync(`pkill -f ${JSON.stringify(app)}`, { timeout: 5000 });
    }
    return {
      ok: true,
      title: `CLOSE ${app.toUpperCase()}`,
      speak: `${app} has been closed.`,
      detail: `Termination signal sent to processes matching "${app}".`,
    };
  } catch (error) {
    return {
      ok: false,
      title: `CLOSE FAILED — ${app}`,
      speak: `No running process matched ${app}.`,
      reason: error instanceof Error ? error.message.split("\n")[0] : "Unknown error",
      action: "Check the process list in the System panel and use the exact process name.",
    };
  }
}

export async function openUrl(url: string): Promise<ToolResult> {
  const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  try {
    new URL(normalized);
  } catch {
    return {
      ok: false,
      title: "INVALID URL",
      speak: "That address is not a valid URL.",
      reason: `"${url}" could not be parsed.`,
      action: "Provide a full address such as https://example.com",
    };
  }
  try {
    const cmd =
      process.platform === "win32" ? "start" : process.platform === "darwin" ? "open" : "xdg-open";
    if (process.platform === "win32") {
      spawn("cmd", ["/c", "start", "", normalized], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn(cmd, [normalized], { detached: true, stdio: "ignore" }).unref();
    }
    return {
      ok: true,
      title: "OPEN URL",
      speak: `Opening ${new URL(normalized).hostname}.`,
      detail: normalized,
      data: { url: normalized, openInBrowserTab: true },
    };
  } catch (error) {
    return {
      ok: false,
      title: "OPEN URL FAILED",
      speak: "I could not open that address on the host.",
      reason: error instanceof Error ? error.message : "spawn failure",
      action: "The link is available in the response — open it manually.",
      data: { url: normalized, openInBrowserTab: true },
    };
  }
}

/* ------------------------------------------------------------- clipboard */

export async function clipboardWrite(text: string): Promise<ToolResult> {
  try {
    const cmd =
      process.platform === "win32" ? "clip" : process.platform === "darwin" ? "pbcopy" : "xclip -selection clipboard";
    const child = spawn(cmd, { shell: true });
    child.stdin.write(text);
    child.stdin.end();
    await new Promise<void>((resolve, reject) => {
      child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`exit ${code}`))));
      child.on("error", reject);
    });
    clipboardFallback.__mr00100Clipboard = text;
    return { ok: true, title: "CLIPBOARD WRITE", speak: "Copied to clipboard.", detail: text.slice(0, 120) };
  } catch {
    clipboardFallback.__mr00100Clipboard = text;
    return {
      ok: true,
      title: "CLIPBOARD WRITE (INTERNAL)",
      speak: "Stored in the MR00100 internal clipboard.",
      detail: "No OS clipboard binary available on this host; value kept in the session buffer.",
      data: { text, useBrowserClipboard: true },
    };
  }
}

export async function clipboardRead(): Promise<ToolResult> {
  try {
    const cmd =
      process.platform === "win32"
        ? "powershell -NoProfile -Command Get-Clipboard"
        : process.platform === "darwin"
          ? "pbpaste"
          : "xclip -selection clipboard -o";
    const { stdout } = await execAsync(cmd, { timeout: 4000 });
    return { ok: true, title: "CLIPBOARD READ", speak: "Clipboard content retrieved.", detail: stdout.slice(0, 400), data: { text: stdout } };
  } catch {
    const text = clipboardFallback.__mr00100Clipboard ?? "";
    return {
      ok: Boolean(text),
      title: "CLIPBOARD READ (INTERNAL)",
      speak: text ? "Internal clipboard content retrieved." : "The clipboard is empty.",
      detail: text.slice(0, 400),
      reason: text ? undefined : "No OS clipboard access and the internal buffer is empty.",
      action: text ? undefined : "Copy something first, or grant clipboard tooling on the host.",
      data: { text },
    };
  }
}

/* ----------------------------------------------------------------- audio */

export async function setVolume(level: number): Promise<ToolResult> {
  const value = Math.max(0, Math.min(100, Math.round(level)));
  try {
    if (process.platform === "darwin") {
      await execAsync(`osascript -e "set volume output volume ${value}"`, { timeout: 4000 });
    } else if (process.platform === "linux") {
      await execAsync(`amixer -q sset Master ${value}%`, { timeout: 4000 });
    } else {
      throw new Error("no native windows mixer binary bundled");
    }
    return { ok: true, title: `VOLUME ${value}%`, speak: `Volume set to ${value} percent.` };
  } catch (error) {
    return {
      ok: false,
      title: "VOLUME CONTROL UNAVAILABLE",
      speak: `I cannot change the system volume on this host, but interface audio is set to ${value} percent.`,
      reason: error instanceof Error ? error.message : "mixer unavailable",
      action: "Install amixer (Linux) or run MR00100 on the desktop host for OS mixer control.",
      data: { level: value, applyToUi: true },
    };
  }
}

/* ------------------------------------------------------------------ files */

export async function fileCreate(rel: string, content = ""): Promise<ToolResult> {
  await ensureWorkspace();
  const full = resolveSafe(rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, "utf8");
  return {
    ok: true,
    title: "FILE CREATED",
    speak: `Created ${path.basename(full)}.`,
    detail: toRelative(full),
    data: { path: toRelative(full) },
  };
}

export async function fileDelete(rel: string): Promise<ToolResult> {
  const full = resolveSafe(rel);
  const st = await fs.stat(full).catch(() => null);
  if (!st) {
    throw new WorkspaceError("NOT FOUND", `"${rel}" does not exist.`, "Refresh the explorer.");
  }
  await fs.rm(full, { recursive: st.isDirectory(), force: false });
  return { ok: true, title: "DELETED", speak: `${path.basename(full)} deleted.`, detail: rel };
}

export async function fileRename(from: string, to: string): Promise<ToolResult> {
  const src = resolveSafe(from);
  const dst = resolveSafe(to);
  await fs.mkdir(path.dirname(dst), { recursive: true });
  await fs.rename(src, dst);
  return { ok: true, title: "RENAMED", speak: `Renamed to ${path.basename(dst)}.`, detail: `${from} → ${to}` };
}

export async function fileCopy(from: string, to: string): Promise<ToolResult> {
  const src = resolveSafe(from);
  const dst = resolveSafe(to);
  await fs.mkdir(path.dirname(dst), { recursive: true });
  await fs.cp(src, dst, { recursive: true });
  return { ok: true, title: "COPIED", speak: `Copied to ${path.basename(dst)}.`, detail: `${from} → ${to}` };
}

export async function makeDir(rel: string): Promise<ToolResult> {
  const full = resolveSafe(rel);
  await fs.mkdir(full, { recursive: true });
  return { ok: true, title: "DIRECTORY CREATED", speak: `Directory ${path.basename(full)} ready.`, detail: toRelative(full) };
}

export async function openFolder(rel: string): Promise<ToolResult> {
  const full = resolveSafe(rel || ".");
  const entries = await listDir(rel || ".");
  try {
    if (process.platform === "win32") spawn("explorer", [full], { detached: true, stdio: "ignore" }).unref();
    else if (process.platform === "darwin") spawn("open", [full], { detached: true, stdio: "ignore" }).unref();
    else spawn("xdg-open", [full], { detached: true, stdio: "ignore" }).unref();
  } catch {
    /* explorer HUD still opens below */
  }
  return {
    ok: true,
    title: "OPEN FOLDER",
    speak: `${entries.length} entries in ${rel || "workspace root"}.`,
    detail: entries.map((e) => e.name).slice(0, 12).join(", "),
    data: { path: rel || "", entries, openPanel: "files" },
  };
}

export async function searchFiles(query: string): Promise<ToolResult> {
  const results = await searchWorkspace(query);
  return {
    ok: true,
    title: `SEARCH "${query}"`,
    speak: results.length ? `${results.length} matches found.` : "No files matched that query.",
    detail: results.map((r) => r.path).slice(0, 10).join("\n"),
    data: { results, openPanel: "files" },
  };
}

export async function readFileTool(rel: string): Promise<ToolResult> {
  const file = await readFileSafe(rel);
  return {
    ok: true,
    title: `READ ${file.path}`,
    speak: `${file.path} loaded, ${file.content.split("\n").length} lines.`,
    detail: file.content.slice(0, 600),
    data: file,
  };
}

/* ----------------------------------------------------------------- system */

export async function systemInfo(kind: string): Promise<ToolResult> {
  const t = await collectTelemetry(kind === "process");
  const map: Record<string, ToolResult> = {
    cpu: {
      ok: true,
      title: "CPU STATUS",
      speak: `CPU is at ${t.cpu.usage.toFixed(0)} percent across ${t.cpu.cores} cores.`,
      detail: `${t.cpu.model} · load ${t.cpu.load1}`,
      data: t,
    },
    ram: {
      ok: true,
      title: "MEMORY STATUS",
      speak: `Memory usage is ${t.ram.usedPct.toFixed(0)} percent, ${t.ram.usedGb} of ${t.ram.totalGb} gigabytes.`,
      detail: `${t.ram.usedGb} GB / ${t.ram.totalGb} GB`,
      data: t,
    },
    disk: {
      ok: Boolean(t.disk),
      title: "DISK STATUS",
      speak: t.disk
        ? `Disk is ${t.disk.usedPct.toFixed(0)} percent used, ${t.disk.usedGb} of ${t.disk.totalGb} gigabytes.`
        : "Disk statistics are unavailable on this host.",
      detail: t.disk ? t.disk.mount : undefined,
      reason: t.disk ? undefined : "statfs is not supported by this runtime",
      action: t.disk ? undefined : "Upgrade Node.js to 18.15+ for disk telemetry.",
      data: t,
    },
    network: {
      ok: true,
      title: "NETWORK STATUS",
      speak: `Network is ${t.network.online ? "online" : "offline"} at ${t.network.address}, receiving ${t.network.rxMbps} megabytes per second.`,
      detail: `RX ${t.network.rxMbps} MB/s · TX ${t.network.txMbps} MB/s · latency ${t.network.latencyMs ?? "n/a"} ms`,
      data: t,
    },
    battery: {
      ok: Boolean(t.battery),
      title: "BATTERY STATUS",
      speak: t.battery
        ? `Battery is at ${t.battery.level} percent and ${t.battery.charging ? "charging" : "discharging"}.`
        : "No battery is present on this host.",
      reason: t.battery ? undefined : "No power supply device exposed",
      action: t.battery ? undefined : "Desktop hosts report no battery — this is expected.",
      data: t,
    },
    process: {
      ok: true,
      title: "TOP PROCESSES",
      speak: t.processes.length
        ? `Top process is ${t.processes[0].name} at ${t.processes[0].cpu.toFixed(1)} percent CPU.`
        : "Process enumeration is unavailable on this host.",
      detail: t.processes.map((p) => `${p.pid} ${p.name} ${p.cpu}%`).join("\n"),
      data: t,
    },
    all: {
      ok: true,
      title: "SYSTEM OVERVIEW",
      speak: `CPU ${t.cpu.usage.toFixed(0)} percent, memory ${t.ram.usedPct.toFixed(0)} percent, ${t.network.online ? "network online" : "network offline"}.`,
      detail: `${t.host.platform} ${t.host.release} · ${t.host.hostname} · uptime ${(t.host.uptimeSec / 3600).toFixed(1)}h`,
      data: t,
    },
  };
  return map[kind] ?? map.all;
}

export async function workspaceOverview(): Promise<ToolResult> {
  await ensureWorkspace();
  const [entries, recent] = await Promise.all([listDir("."), recentFiles(8)]);
  return {
    ok: true,
    title: "WORKSPACE",
    speak: `Workspace has ${entries.length} top level entries.`,
    detail: workspaceRoot(),
    data: { root: workspaceRoot(), entries, recent, openPanel: "files" },
  };
}
