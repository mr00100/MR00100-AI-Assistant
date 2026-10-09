import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execCapture, spawnDetached, spawnDetachedChecked, windowsStart } from "./shell";
import { existsDir } from "./finder";

export type SystemResult = { ok: boolean; speak: string; detail?: string; reason?: string; action?: string; data?: Record<string, unknown> };

/* ------------------------------------------------------- Windows Settings */

const SETTINGS_ALIASES: Record<string, string> = {
  settings: "",
  display: "display",
  screen: "display",
  "display settings": "display",
  sound: "sound",
  audio: "sound",
  "sound settings": "sound",
  network: "network",
  internet: "network",
  "network settings": "network",
  wifi: "network-wifi",
  "wi-fi": "network-wifi",
  "wi fi": "network-wifi",
  notifications: "notifications",
  "installed apps": "appsfeatures",
  bluetooth: "bluetooth",
  update: "windowsupdate",
  "windows update": "windowsupdate",
  "windows update settings": "windowsupdate",
  "update settings": "windowsupdate",
  personalization: "personalization",
  themes: "themes",
  apps: "appsfeatures",
  privacy: "privacy",
  security: "privacy-security",
  activation: "activation",
  power: "power",
  "power settings": "power",
  storage: "storagesense",
  accounts: "yourinfo",
  "default apps": "defaultapps",
  "default apps settings": "defaultapps",
  "keyboard settings": "keyboard",
  mouse: "mousetouchpad",
  "mouse settings": "mousetouchpad",
  time: "dateandtime",
  "time settings": "dateandtime",
  language: "regionlanguage",
  "region settings": "regionlanguage",
  about: "about",
  "system about": "about",
  "device manager": "devicemanager",
  "task manager": "taskmgr",
};

export function settingsUriFor(subjectRaw: string): string | null {
  const subject = subjectRaw.trim().toLowerCase().replace(/\s+settings$/, "").replace(/\s+/g, " ").trim();
  if (!(subject in SETTINGS_ALIASES)) return null;
  const page = SETTINGS_ALIASES[subject];
  return page ? `ms-settings:${page}` : "ms-settings:";
}

export async function openWindowsSettings(subject = "settings"): Promise<SystemResult> {
  const uri = settingsUriFor(subject);
  if (!uri) {
    return {
      ok: false,
      speak: `I don't have a Windows Settings page for "${subject}".`,
      reason: `No ms-settings: page is mapped to "${subject}".`,
      action: "Try display, network, sound, bluetooth, windowsupdate, or power.",
    };
  }
  if (process.platform !== "win32") {
    return {
      ok: false,
      speak: "Windows Settings is only available on Windows.",
      reason: `ms-settings: URIs require Windows, but this host is ${process.platform}.`,
      action: "Run MR00100 on your Windows computer to control Settings.",
      data: { uri },
    };
  }
  try {
    await spawnDetachedChecked("explorer.exe", [uri]);
    return { ok: true, speak: `Windows Settings opened (${subject}).`, detail: uri, data: { uri } };
  } catch (error) {
    return {
      ok: false,
      speak: "I couldn't open Windows Settings.",
      reason: error instanceof Error ? error.message : "explorer.exe launch failed.",
      action: "Open Settings manually from the Start menu.",
      data: { uri },
    };
  }
}

/* ------------------------------------------------------------- Start Menu */

export async function openStartMenu(): Promise<SystemResult> {
  if (process.platform !== "win32") {
    return {
      ok: false,
      speak: "The Windows Start menu is only available on Windows.",
      reason: `Start menu control requires Windows, but this host is ${process.platform}.`,
      action: "Run MR00100 on your Windows computer.",
    };
  }
  // Windows 10/11 expose the shell AppView via explorer shell:AppsFolder; the
  // documented keyboard route is the most reliable programmatic trigger.
  const attempts: Array<{ label: string; run: () => Promise<number> }> = [
    { label: "explorer shell:AppsFolder", run: () => spawnDetachedChecked("explorer.exe", ["shell:AppsFolder"]) },
    { label: "rundll32 shell.dll,OpenAsDialog", run: () => spawnDetachedChecked("rundll32.exe", ["shell.dll,OpenAsDialog"]) },
  ];
  const failures: string[] = [];
  for (const attempt of attempts) {
    try {
      await attempt.run();
      return { ok: true, speak: "Start menu opened.", detail: attempt.label, data: { method: attempt.label } };
    } catch (error) {
      failures.push(`${attempt.label}: ${error instanceof Error ? error.message : "failed"}`);
    }
  }
  return {
    ok: false,
    speak: "I couldn't open the Start menu automatically.",
    reason: failures.join("; "),
    action: "Press the Windows key, or use the Start menu manually.",
  };
}

/* -------------------------------------------------------------- Recycle Bin */

export async function openRecycleBin(): Promise<SystemResult> {
  if (process.platform === "win32") {
    try {
      await spawnDetachedChecked("explorer.exe", ["shell:RecycleBinFolder"]);
      return { ok: true, speak: "Recycle Bin opened.", detail: "shell:RecycleBinFolder" };
    } catch (error) {
      return { ok: false, speak: "I couldn't open the Recycle Bin.", reason: error instanceof Error ? error.message : "launch failed" };
    }
  }
  const home = process.env.HOME || os.homedir();
  const candidates = [path.join(home, ".local/share/Trash"), path.join(home, ".Trash")];
  for (const dir of candidates) {
    if (await existsDir(dir)) {
      spawnDetached("xdg-open", [dir]);
      return { ok: true, speak: "Trash opened.", detail: dir };
    }
  }
  return {
    ok: false,
    speak: "No Recycle Bin was found on this system.",
    reason: "Neither shell:RecycleBinFolder nor a Linux trash directory was available.",
    action: "Empty the trash from your file manager instead.",
  };
}

export async function emptyRecycleBin(): Promise<SystemResult> {
  if (process.platform === "win32") {
    const script = [
      "$ErrorActionPreference = 'Stop'",
      "Clear-RecycleBin -Force -ErrorAction Stop",
      "Write-Output 'RecycleBinCleared'",
    ].join("; ");
    const result = await execCapture("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], 45_000);
    if (result.ok && result.stdout.includes("RecycleBinCleared")) {
      return { ok: true, speak: "Recycle Bin emptied.", detail: "Clear-RecycleBin -Force" };
    }
    return {
      ok: false,
      speak: "I couldn't empty the Recycle Bin.",
      reason: result.stderr || result.stdout || "Clear-RecycleBin did not report success.",
      action: "Empty the Recycle Bin manually from the desktop icon.",
    };
  }
  const home = process.env.HOME || os.homedir();
  const trash = path.join(home, ".local/share/Trash");
  if (!(await existsDir(trash))) {
    return { ok: false, speak: "No trash directory was found.", reason: `${trash} does not exist.`, action: "Nothing to empty." };
  }
  for (const sub of ["files", "info"]) {
    const dir = path.join(trash, sub);
    if (await existsDir(dir)) {
      const items = await fs.readdir(dir).catch(() => [] as string[]);
      for (const item of items) await fs.rm(path.join(dir, item), { recursive: true, force: true }).catch(() => null);
    }
  }
  return { ok: true, speak: "Trash emptied.", detail: trash };
}

/** Restore an item from the Recycle Bin by name, or the most recent one. */
export async function restoreFromRecycleBin(name = ""): Promise<SystemResult> {
  if (process.platform !== "win32") {
    return {
      ok: false,
      speak: "Recycle Bin restore is only available on Windows.",
      reason: `Shell restore requires Windows, but this host is ${process.platform}.`,
      action: "Run MR00100 on your Windows computer.",
    };
  }
  const safeName = name.replace(/['"\r\n]/g, "");
  const script = [
    "$ErrorActionPreference='Stop'",
    "$shell = New-Object -ComObject Shell.Application",
    "$bin = $shell.Namespace(0xA)",
    "$items = @($bin.Items())",
    safeName
      ? `$items = @($items | Where-Object { $_.Name -like '*${safeName}*' })`
      : "$items = @($items | Sort-Object { $bin.GetDetailsOf($_, 2) } -Descending | Select-Object -First 1)",
    "if ($items.Count -eq 0) { Write-Output 'NONE'; exit 0 }",
    "$restored = 0",
    "foreach ($item in $items) {",
    "  $verb = $item.Verbs() | Where-Object { $_.Name -replace '&','' -match 'Restore' } | Select-Object -First 1",
    "  if ($verb) { $verb.DoIt(); $restored++ }",
    "}",
    "Write-Output ('RESTORED=' + $restored + ' NAME=' + $items[0].Name)",
  ].join("; ");
  const result = await execCapture("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], 30_000);
  if (!result.ok) {
    return { ok: false, speak: "I couldn't restore from the Recycle Bin.", reason: result.stderr || result.stdout, action: "Open the Recycle Bin and restore manually." };
  }
  if (result.stdout.includes("NONE")) {
    return { ok: false, speak: name ? `Nothing matching "${name}" is in the Recycle Bin.` : "The Recycle Bin is empty.", reason: "No matching item found in shell:RecycleBinFolder." };
  }
  const restored = /RESTORED=(\d+)/.exec(result.stdout)?.[1] ?? "0";
  const itemName = /NAME=(.+)$/m.exec(result.stdout)?.[1]?.trim();
  return {
    ok: Number(restored) > 0,
    speak: Number(restored) > 0 ? `${itemName ?? "Item"} restored.` : "Restore verb was not available for that item.",
    detail: result.stdout.trim(),
    data: { restored: Number(restored), name: itemName },
  };
}

/* ------------------------------------------------------------ Power control */

export type PowerAction = "shutdown" | "restart" | "sleep" | "hibernate" | "lock" | "signout" | "cancel";

const POWER_COMMANDS: Record<PowerAction, { exe: string; args: string[]; speak: string }> = {
  shutdown: { exe: "shutdown.exe", args: ["/s", "/t", "60"], speak: "The PC will shut down in 60 seconds. Run `cancel shutdown` to stop it." },
  restart: { exe: "shutdown.exe", args: ["/r", "/t", "60"], speak: "The PC will restart in 60 seconds. Run `cancel shutdown` to stop it." },
  cancel: { exe: "shutdown.exe", args: ["/a"], speak: "Pending shutdown cancelled." },
  sleep: { exe: "rundll32.exe", args: ["powrprof.dll,SetSuspendState", "0,1,0"], speak: "The PC is going to sleep." },
  hibernate: { exe: "shutdown.exe", args: ["/h"], speak: "The PC is hibernating." },
  lock: { exe: "rundll32.exe", args: ["user32.dll,LockWorkStation"], speak: "Workstation locked." },
  signout: { exe: "shutdown.exe", args: ["/l"], speak: "Signing out." },
};

export async function runPowerAction(action: PowerAction): Promise<SystemResult> {
  if (process.platform !== "win32") {
    return {
      ok: false,
      speak: `${action} is only available on Windows.`,
      reason: `Power control uses Windows system binaries, but this host is ${process.platform}.`,
      action: "Run MR00100 on your Windows computer for power control.",
    };
  }
  const spec = POWER_COMMANDS[action];
  try {
    await spawnDetachedChecked(spec.exe, spec.args);
    return { ok: true, speak: spec.speak, detail: `${spec.exe} ${spec.args.join(" ")}`, data: { action } };
  } catch (error) {
    return {
      ok: false,
      speak: `I couldn't ${action === "cancel" ? "cancel the shutdown" : action} the PC.`,
      reason: error instanceof Error ? error.message : `${spec.exe} launch failed.`,
      action: "Perform the action manually; MR00100 never claims success without a real launch.",
    };
  }
}

/* ------------------------------------------------------------------ Drives */

export async function listDrives(): Promise<SystemResult> {
  if (process.platform === "win32") {
    const powershell = [
      "Get-CimInstance Win32_LogicalDisk -Filter \"DriveType=3\" |",
      "Select-Object DeviceID,VolumeName,FileSystem,",
      "@{Name='TotalGB';Expression={[math]::Round($_.Size/1GB,1)}},",
      "@{Name='FreeGB';Expression={[math]::Round($_.FreeSpace/1GB,1)}} |",
      "ConvertTo-Json -Compress",
    ].join(" ");
    const result = await execCapture("powershell.exe", ["-NoProfile", "-Command", powershell], 10_000);
    if (result.ok && result.stdout.trim()) {
      try {
        const parsed = JSON.parse(result.stdout.trim()) as
          | { DeviceID: string; VolumeName?: string; FileSystem?: string; TotalGB?: number; FreeGB?: number }
          | Array<{ DeviceID: string; VolumeName?: string; FileSystem?: string; TotalGB?: number; FreeGB?: number }>;
        const drives = (Array.isArray(parsed) ? parsed : [parsed]).filter((d) => /^[A-Z]:$/i.test(d.DeviceID));
        if (drives.length) {
          return {
            ok: true,
            speak: `${drives.length} drive${drives.length === 1 ? "" : "s"} available: ${drives.map((d) => d.DeviceID.toUpperCase()).join(", ")}.`,
            detail: drives
              .map((d) => `${d.DeviceID} ${d.VolumeName || "Local Disk"} · ${d.FileSystem || "unknown"} · ${d.FreeGB ?? "?"}/${d.TotalGB ?? "?"} GB free`)
              .join("\n"),
            data: {
              drives: drives.map((d) => ({
                path: `${d.DeviceID.toUpperCase()}\\`,
                letter: d.DeviceID.toUpperCase(),
                label: d.VolumeName || "Local Disk",
                filesystem: d.FileSystem || "unknown",
                totalGb: d.TotalGB,
                freeGb: d.FreeGB,
              })),
            },
          };
        }
      } catch {
        /* fall through to portable volume detection */
      }
    }
  }
  const roots: string[] = [];
  for (const base of ["/mnt", "/media", "/Volumes"]) {
    try {
      for (const entry of await fs.readdir(base, { withFileTypes: true })) roots.push(path.join(base, entry.name));
    } catch {
      /* missing mount root */
    }
  }
  if (roots.length === 0) {
    try {
      const mounts = await fs.readFile("/proc/mounts", "utf8");
      for (const line of mounts.split("\n")) {
        const mountPoint = line.trim().split(/\s+/)[1];
        if (!mountPoint) continue;
        if (!/^\/(media|mnt|run\/media|Volumes)(\/|$)/.test(mountPoint)) continue;
        if (await existsDir(mountPoint)) roots.push(mountPoint);
      }
    } catch {
      /* /proc/mounts unavailable */
    }
  }
  if (roots.length === 0) roots.push("/");
  return {
    ok: roots.length > 0,
    speak: roots.length ? `Available volumes: ${roots.join(", ")}.` : "No additional volumes were found.",
    detail: roots.join("\n"),
    data: { drives: roots },
  };
}

export async function systemOverview(): Promise<SystemResult> {
  if (process.platform === "win32") {
    const script = [
      "$os = Get-CimInstance Win32_OperatingSystem",
      "$cs = Get-CimInstance Win32_ComputerSystem",
      "$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1",
      "$gpu = Get-CimInstance Win32_VideoController | Select-Object -First 1",
      "[PSCustomObject]@{",
      "  os = $os.Caption;",
      "  version = $os.Version;",
      "  build = $os.BuildNumber;",
      "  ramGb = [math]::Round($cs.TotalPhysicalMemory / 1GB, 1);",
      "  cpu = $cpu.Name;",
      "  cores = $cpu.NumberOfCores;",
      "  logical = $cpu.NumberOfLogicalProcessors;",
      "  gpu = $gpu.Name;",
      "  host = $env:COMPUTERNAME",
      "} | ConvertTo-Json -Compress",
    ].join(" ");
    const result = await execCapture("powershell.exe", ["-NoProfile", "-Command", script], 15_000);
    if (result.ok && result.stdout.trim().startsWith("{")) {
      try {
        const info = JSON.parse(result.stdout.trim()) as Record<string, string | number>;
        const cpuName = typeof info.cpu === "string" ? info.cpu.trim() : "unknown CPU";
        return {
          ok: true,
          speak: `${info.os} ${info.version}, ${cpuName}, ${info.ramGb} GB RAM.`,
          detail: JSON.stringify(info, null, 2),
          data: info as unknown as Record<string, unknown>,
        };
      } catch {
        /* fall through to node info */
      }
    }
  }
  const cpus = os.cpus();
  return {
    ok: true,
    speak: `${os.type()} ${os.release()}, ${cpus[0]?.model?.trim() ?? "unknown CPU"}, ${(os.totalmem() / 1e9).toFixed(1)} GB RAM.`,
    detail: `${cpus.length} logical cores · ${os.hostname()}`,
    data: { os: os.type(), version: os.release(), cpu: cpus[0]?.model, cores: cpus.length, ramGb: +(os.totalmem() / 1e9).toFixed(1) },
  };
}

export async function gpuInfo(): Promise<SystemResult> {
  if (process.platform === "win32") {
    const script = "Get-CimInstance Win32_VideoController | Select-Object Name, DriverVersion | ConvertTo-Json -Compress";
    const result = await execCapture("powershell.exe", ["-NoProfile", "-Command", script], 10_000);
    if (result.ok && result.stdout.trim().startsWith("{")) {
      const parsed = JSON.parse(result.stdout.trim()) as { Name?: string; DriverVersion?: string } | Array<{ Name?: string; DriverVersion?: string }>;
      const first = Array.isArray(parsed) ? parsed[0] : parsed;
      return {
        ok: Boolean(first?.Name),
        speak: first?.Name ? `GPU: ${first.Name}.` : "No GPU information was returned.",
        detail: first?.DriverVersion ? `driver ${first.DriverVersion}` : undefined,
        data: first as unknown as Record<string, unknown>,
      };
    }
  }
  return {
    ok: false,
    speak: "I couldn't read GPU information on this host.",
    reason: `GPU enumeration via WMI requires Windows, but this host is ${process.platform}.`,
    action: "Check Device Manager for your display adapter.",
  };
}

export async function openWindowsSearch(query: string): Promise<SystemResult> {
  if (process.platform !== "win32") {
    return {
      ok: false,
      speak: "Windows Search is only available on Windows.",
      reason: `Search UI control requires Windows, but this host is ${process.platform}.`,
      action: "Run MR00100 on your Windows computer.",
    };
  }
  try {
    await spawnDetachedChecked("explorer.exe", [`search-ms:query=${query}`]);
    return { ok: true, speak: `Windows Search opened for "${query}".`, detail: query };
  } catch (error) {
    return {
      ok: false,
      speak: "I couldn't open Windows Search.",
      reason: error instanceof Error ? error.message : "search-ms launch failed.",
      action: "Open search from the taskbar manually.",
    };
  }
}

export async function openControlPanel(): Promise<SystemResult> {
  if (process.platform === "win32") {
    try {
      await spawnDetachedChecked("control.exe", []);
      return { ok: true, speak: "Control Panel opened.", detail: "control.exe" };
    } catch (error) {
      return { ok: false, speak: "I couldn't open Control Panel.", reason: error instanceof Error ? error.message : "launch failed" };
    }
  }
  return {
    ok: false,
    speak: "Windows Control Panel is only available on Windows.",
    reason: `control.exe requires Windows, but this host is ${process.platform}.`,
    action: "Use your Linux system settings instead.",
  };
}

export { windowsStart };
