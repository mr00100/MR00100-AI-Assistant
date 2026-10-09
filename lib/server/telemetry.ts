import { promises as fs } from "node:fs";
import os from "node:os";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { workspaceRoot } from "./workspace";

const execAsync = promisify(exec);

export type ProcessInfo = { pid: number; name: string; cpu: number; mem: number };

export type Telemetry = {
  timestamp: number;
  cpu: { usage: number; cores: number; model: string; load1: number; speedMhz: number };
  ram: { usedPct: number; usedGb: number; totalGb: number };
  disk: { usedPct: number; usedGb: number; totalGb: number; mount: string } | null;
  network: {
    online: boolean;
    rxMbps: number;
    txMbps: number;
    interfaces: number;
    address: string;
    latencyMs: number | null;
  };
  battery: { level: number; charging: boolean } | null;
  processes: ProcessInfo[];
  host: { platform: string; release: string; hostname: string; uptimeSec: number; arch: string };
};

type CpuSample = { idle: number; total: number };

const g = globalThis as typeof globalThis & {
  __mr00100Cpu?: CpuSample;
  __mr00100Net?: { rx: number; tx: number; t: number };
  __mr00100Latency?: { value: number | null; t: number };
};

function sampleCpu(): CpuSample {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    for (const key of Object.keys(cpu.times) as Array<keyof typeof cpu.times>) {
      total += cpu.times[key];
    }
    idle += cpu.times.idle;
  }
  return { idle, total };
}

function cpuUsage(): number {
  const now = sampleCpu();
  const prev = g.__mr00100Cpu;
  g.__mr00100Cpu = now;
  if (!prev) return Math.min(100, Math.max(0, os.loadavg()[0] * (100 / os.cpus().length)));
  const idleDelta = now.idle - prev.idle;
  const totalDelta = now.total - prev.total;
  if (totalDelta <= 0) return 0;
  return Math.min(100, Math.max(0, (1 - idleDelta / totalDelta) * 100));
}

async function diskUsage(): Promise<Telemetry["disk"]> {
  const statfs = (fs as unknown as {
    statfs?: (p: string) => Promise<{ bsize: number; blocks: number; bavail: number }>;
  }).statfs;
  if (!statfs) return null;
  for (const target of [workspaceRoot(), process.cwd(), "/"]) {
    try {
      const s = await statfs(target);
      const totalGb = (s.bsize * s.blocks) / 1e9;
      const freeGb = (s.bsize * s.bavail) / 1e9;
      const usedGb = totalGb - freeGb;
      if (totalGb <= 0) continue;
      return {
        totalGb: +totalGb.toFixed(1),
        usedGb: +usedGb.toFixed(1),
        usedPct: +((usedGb / totalGb) * 100).toFixed(1),
        mount: target,
      };
    } catch {
      /* try the next mount point */
    }
  }
  return null;
}

async function networkThroughput() {
  let rx = 0;
  let tx = 0;
  try {
    const raw = await fs.readFile("/proc/net/dev", "utf8");
    for (const line of raw.split("\n").slice(2)) {
      const [iface, rest] = line.split(":");
      if (!rest || iface.trim() === "lo") continue;
      const cols = rest.trim().split(/\s+/).map(Number);
      rx += cols[0] || 0;
      tx += cols[8] || 0;
    }
  } catch {
    return { rxMbps: 0, txMbps: 0 };
  }
  const now = Date.now();
  const prev = g.__mr00100Net;
  g.__mr00100Net = { rx, tx, t: now };
  if (!prev || now === prev.t) return { rxMbps: 0, txMbps: 0 };
  const dt = (now - prev.t) / 1000;
  return {
    rxMbps: +Math.max(0, (rx - prev.rx) / dt / 1e6).toFixed(2),
    txMbps: +Math.max(0, (tx - prev.tx) / dt / 1e6).toFixed(2),
  };
}

async function batteryInfo(): Promise<Telemetry["battery"]> {
  try {
    const base = "/sys/class/power_supply";
    const entries = await fs.readdir(base);
    const bat = entries.find((e) => /^BAT/i.test(e));
    if (!bat) return null;
    const [cap, status] = await Promise.all([
      fs.readFile(`${base}/${bat}/capacity`, "utf8").catch(() => "0"),
      fs.readFile(`${base}/${bat}/status`, "utf8").catch(() => "Unknown"),
    ]);
    return { level: parseInt(cap.trim(), 10) || 0, charging: /charging/i.test(status) };
  } catch {
    return null;
  }
}

async function topProcesses(): Promise<ProcessInfo[]> {
  try {
    if (process.platform === "win32") {
      const { stdout } = await execAsync(
        'powershell -NoProfile -Command "Get-Process | Sort-Object CPU -Descending | Select-Object -First 6 Id,ProcessName,CPU,WS | ConvertTo-Csv -NoTypeInformation"',
        { timeout: 4000 },
      );
      return stdout
        .split("\n")
        .slice(1)
        .filter(Boolean)
        .map((l) => l.replace(/"/g, "").split(","))
        .map((c) => ({
          pid: Number(c[0]) || 0,
          name: c[1] ?? "unknown",
          cpu: +(Number(c[2]) || 0).toFixed(1),
          mem: +((Number(c[3]) || 0) / 1e6).toFixed(1),
        }))
        .slice(0, 6);
    }
    const { stdout } = await execAsync(
      "ps -eo pid,comm,pcpu,pmem --sort=-pcpu | head -n 7",
      { timeout: 4000 },
    );
    return stdout
      .trim()
      .split("\n")
      .slice(1)
      .map((line) => line.trim().split(/\s+/))
      .map((c) => ({
        pid: Number(c[0]) || 0,
        name: (c[1] ?? "unknown").split("/").pop() ?? "unknown",
        cpu: Number(c[2]) || 0,
        mem: Number(c[3]) || 0,
      }));
  } catch {
    return [];
  }
}

async function latency(): Promise<number | null> {
  const cached = g.__mr00100Latency;
  if (cached && Date.now() - cached.t < 20_000) return cached.value;
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    await fetch("https://openrouter.ai/api/v1/models", {
      method: "HEAD",
      signal: controller.signal,
    });
    clearTimeout(timer);
    const value = Date.now() - start;
    g.__mr00100Latency = { value, t: Date.now() };
    return value;
  } catch {
    g.__mr00100Latency = { value: null, t: Date.now() };
    return null;
  }
}

function primaryAddress() {
  const nets = os.networkInterfaces();
  for (const list of Object.values(nets)) {
    for (const n of list ?? []) {
      if (n.family === "IPv4" && !n.internal) return n.address;
    }
  }
  return "127.0.0.1";
}

export async function collectTelemetry(withProcesses = true): Promise<Telemetry> {
  const cpus = os.cpus();
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  const [disk, net, battery, procs, lat] = await Promise.all([
    diskUsage(),
    networkThroughput(),
    batteryInfo(),
    withProcesses ? topProcesses() : Promise.resolve([]),
    latency(),
  ]);

  const interfaces = Object.values(os.networkInterfaces())
    .flat()
    .filter((n) => n && !n.internal).length;

  return {
    timestamp: Date.now(),
    cpu: {
      usage: +cpuUsage().toFixed(1),
      cores: cpus.length,
      model: cpus[0]?.model?.replace(/\s+/g, " ").trim() ?? "unknown",
      load1: +(os.loadavg()[0] ?? 0).toFixed(2),
      speedMhz: cpus[0]?.speed ?? 0,
    },
    ram: {
      usedPct: +((used / total) * 100).toFixed(1),
      usedGb: +(used / 1e9).toFixed(2),
      totalGb: +(total / 1e9).toFixed(2),
    },
    disk,
    network: {
      online: interfaces > 0,
      rxMbps: net.rxMbps,
      txMbps: net.txMbps,
      interfaces,
      address: primaryAddress(),
      latencyMs: lat,
    },
    battery,
    processes: procs,
    host: {
      platform: process.platform,
      release: os.release(),
      hostname: os.hostname(),
      uptimeSec: Math.round(os.uptime()),
      arch: os.arch(),
    },
  };
}
