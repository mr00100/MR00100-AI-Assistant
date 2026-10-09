"use client";

import { useState } from "react";
import { Bar, Panel, Row, StatusDot } from "./ui";
import { useStore } from "@/lib/client/store";

export function SystemMonitor({ onClose }: { onClose?: () => void } = {}) {
  const t = useStore((s) => s.telemetry);
  const err = useStore((s) => s.telemetryError);
  const quality = useStore((s) => s.quality);
  const fps = useStore((s) => s.fps);

  return (
    <Panel
      title="SYSTEM MONITOR"
      onClose={onClose}
      right={
        <span className="dim mono-xs">
          {quality.toUpperCase()} · {fps}FPS
        </span>
      }
      className="h-full"
    >
      <div className="space-y-2.5 p-3">
        {err ? (
          <div className="mono-xs" style={{ color: "rgb(var(--mr-danger))" }}>
            {err}
          </div>
        ) : null}
        {!t ? (
          <div className="dim mono-xs blink">ACQUIRING TELEMETRY…</div>
        ) : (
          <>
            <Bar label="CPU" value={t.cpu.usage} detail={`${t.cpu.cores} cores · load ${t.cpu.load1}`} />
            <Bar label="RAM" value={t.ram.usedPct} detail={`${t.ram.usedGb} / ${t.ram.totalGb} GB`} />
            <Bar
              label="DISK"
              value={t.disk?.usedPct ?? 0}
              detail={t.disk ? `${t.disk.usedGb} / ${t.disk.totalGb} GB` : "statfs unavailable"}
            />
            <div>
              <div className="flex items-baseline justify-between">
                <span className="hud-label">NETWORK</span>
                <span className="text-[11px] tabular-nums">
                  {t.network.rxMbps.toFixed(1)} <span className="dim">MB/s</span>
                </span>
              </div>
              <div className="dim mono-xs mt-0.5">
                ↓{t.network.rxMbps.toFixed(2)} ↑{t.network.txMbps.toFixed(2)} ·{" "}
                {t.network.latencyMs != null ? `${t.network.latencyMs}ms` : "no probe"}
              </div>
            </div>
            {t.battery ? (
              <Bar
                label="BATTERY"
                value={t.battery.level}
                warnAt={101}
                dangerAt={101}
                detail={t.battery.charging ? "charging" : "discharging"}
              />
            ) : (
              <Row label="BATTERY" value="NOT PRESENT" state="off" />
            )}
            <div className="border-t border-[color:var(--mr-border)] pt-2">
              <div className="hud-label mb-1">PROCESSES</div>
              {t.processes.length === 0 ? (
                <div className="dim mono-xs">enumeration unavailable on this host</div>
              ) : (
                t.processes.slice(0, 5).map((p) => (
                  <div key={p.pid} className="mono-xs flex justify-between gap-2">
                    <span className="truncate">{p.name}</span>
                    <span className="dim tabular-nums">{p.cpu.toFixed(1)}%</span>
                  </div>
                ))
              )}
            </div>
            <div className="dim mono-xs border-t border-[color:var(--mr-border)] pt-2">
              {t.host.platform} {t.host.arch} · {t.host.hostname} · up{" "}
              {(t.host.uptimeSec / 3600).toFixed(1)}h
            </div>
          </>
        )}
      </div>
    </Panel>
  );
}

export function AiEngineHud() {
  const engine = useStore((s) => s.aiEngine);
  const settings = useStore((s) => s.settings);
  const meta = useStore((s) => s.settingsMeta);
  const stateLabel = useStore((s) => s.stateLabel);

  const status = !meta.keyConfigured ? "OFFLINE" : engine.status;
  const dot = status === "ACTIVE" ? "ok" : status === "IDLE" ? "warn" : "off";

  return (
    <Panel title="AI ENGINE" className="shrink-0">
      <div className="space-y-1 p-3">
        <div className="flex items-center justify-between">
          <span className="hud-label">STATUS</span>
          <span className="flex items-center gap-1.5 text-[11px] tracking-[0.18em]">
            <StatusDot state={dot} />
            <span className={status === "ACTIVE" ? "accent glow" : ""}>{status}</span>
          </span>
        </div>
        <Row label="MODEL" value={engine.model || settings.generalModel || "—"} />
        <Row label="DEV MODEL" value={settings.developerModel || "—"} />
        <Row label="TASK" value={engine.task || "NONE"} />
        <Row label="CORE STATE" value={stateLabel} />
        <Row
          label="KEY"
          value={meta.keyConfigured ? `${meta.keySource.toUpperCase()} ${meta.keyMasked}` : "NOT SET"}
          state={meta.keyConfigured ? "ok" : "err"}
        />
        {status === "OFFLINE" ? (
          <p className="dim mono-xs pt-1 leading-relaxed">
            Heavy engine unloaded. Local intents still execute at zero model cost.
          </p>
        ) : null}
      </div>
    </Panel>
  );
}

export function SecurityHud() {
  const s = useStore((st) => st.settings);
  const events = useStore((st) => st.events);
  const online = useStore((st) => st.telemetry?.network.online ?? false);
  const warnings = events.filter((e) => e.level === "error" || e.level === "warn").slice(0, 3);

  const map = (v: string) =>
    v === "SAFE" ? { text: "ALLOWED", state: "ok" as const } : v === "CONFIRM" ? { text: "CONFIRMATION", state: "warn" as const } : { text: "BLOCKED", state: "err" as const };

  return (
    <Panel title="SECURITY" className="shrink-0">
      <div className="space-y-0.5 p-3">
        <Row label="SYSTEM" value="PROTECTED" state="ok" />
        <Row label="AI ACCESS" value={map(s.aiAccess).text} state={map(s.aiAccess).state} />
        <Row label="FILE ACCESS" value={map(s.fileAccess).text} state={map(s.fileAccess).state} />
        <Row label="TERMINAL" value={map(s.terminalAccess).text} state={map(s.terminalAccess).state} />
        <Row label="APP LAUNCH" value={map(s.appLaunchAccess).text} state={map(s.appLaunchAccess).state} />
        <Row label="NETWORK" value={online ? "ONLINE" : "OFFLINE"} state={online ? "ok" : "err"} />
        <Row label="SANDBOX" value="WORKSPACE ONLY" state="ok" />
        {warnings.length ? (
          <div className="mt-2 border-t border-[color:var(--mr-border)] pt-2">
            <div className="hud-label mb-1">ALERTS</div>
            {warnings.map((w) => (
              <div
                key={w.id}
                className="mono-xs truncate"
                style={{ color: w.level === "error" ? "rgb(var(--mr-danger))" : "rgb(var(--mr-warn))" }}
              >
                {w.type}: {w.message}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

export function NetworkHud() {
  const t = useStore((s) => s.telemetry);
  return (
    <Panel title="NETWORK GRID" className="shrink-0">
      <div className="space-y-0.5 p-3">
        <Row
          label="LINK"
          value={t?.network.online ? "ESTABLISHED" : "DOWN"}
          state={t?.network.online ? "ok" : "err"}
        />
        <Row label="LOCAL" value={t?.network.address ?? "—"} />
        <Row label="IFACES" value={String(t?.network.interfaces ?? 0)} />
        <Row
          label="LATENCY"
          value={t?.network.latencyMs != null ? `${t.network.latencyMs} MS` : "NO ROUTE"}
          state={t?.network.latencyMs == null ? "warn" : t.network.latencyMs < 250 ? "ok" : "warn"}
        />
        <Row label="RX" value={`${(t?.network.rxMbps ?? 0).toFixed(2)} MB/S`} />
        <Row label="TX" value={`${(t?.network.txMbps ?? 0).toFixed(2)} MB/S`} />
      </div>
    </Panel>
  );
}

export function HistoryHud({ full = false, onClose }: { full?: boolean; onClose?: () => void }) {
  const history = useStore((s) => s.history);
  const [filter, setFilter] = useState("ALL");
  const rows = history.filter((h) => filter === "ALL" || h.type === filter);

  const color = (status: string) =>
    status === "SUCCESS"
      ? "rgb(var(--mr-accent))"
      : status === "FAILED"
        ? "rgb(var(--mr-danger))"
        : status === "BLOCKED"
          ? "rgb(var(--mr-danger))"
          : "rgb(var(--mr-warn))";

  return (
    <Panel
      title="COMMAND HISTORY"
      className={full ? "h-full" : "min-h-0 flex-1"}
      onClose={onClose}
      right={
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="mono-xs px-1 py-0.5"
        >
          {["ALL", "SYSTEM", "AI", "DEVELOPER", "FILE", "TERMINAL", "NETWORK", "SECURITY"].map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      }
    >
      <div className="p-2">
        {rows.length === 0 ? (
          <div className="dim mono-xs p-2">No executed commands yet.</div>
        ) : (
          <table className="w-full border-collapse">
            <tbody>
              {rows.slice(0, full ? 200 : 14).map((h) => (
                <tr key={h.id} className="border-b border-white/5 align-top">
                  <td className="dim mono-xs w-14 py-1 tabular-nums">
                    {new Date(h.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </td>
                  <td className="mono-xs py-1 pr-2">
                    <div className="truncate" title={h.command}>
                      {h.command}
                    </div>
                    {full && h.detail ? (
                      <div className="dim mono-xs mt-0.5 line-clamp-2 break-all">{h.detail.slice(0, 220)}</div>
                    ) : null}
                  </td>
                  <td className="dim mono-xs w-16 py-1">{h.type}</td>
                  <td
                    className="mono-xs w-16 py-1 text-right"
                    style={{ color: color(h.status) }}
                  >
                    {h.status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Panel>
  );
}

export function EventFeed() {
  const events = useStore((s) => s.events);
  return (
    <Panel title="EVENT BUS" className="min-h-0 flex-1">
      <div className="p-2">
        {events.length === 0 ? (
          <div className="dim mono-xs p-1">Awaiting events…</div>
        ) : (
          events.slice(0, 22).map((e) => (
            <div key={e.id} className="mono-xs flex gap-2 py-[2px]">
              <span className="dim tabular-nums">
                {new Date(e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
              <span
                className="shrink-0"
                style={{
                  color:
                    e.level === "error"
                      ? "rgb(var(--mr-danger))"
                      : e.level === "warn"
                        ? "rgb(var(--mr-warn))"
                        : e.level === "success"
                          ? "rgb(var(--mr-accent))"
                          : undefined,
                }}
              >
                {e.type}
              </span>
              <span className="dim truncate">{e.message}</span>
            </div>
          ))
        )}
      </div>
    </Panel>
  );
}

export function CommandTraceHud() {
  const trace = useStore((s) => s.commandTrace);
  if (!trace) return null;
  const stageColor =
    trace.stage === "FAILED"
      ? "rgb(var(--mr-danger))"
      : trace.stage === "COMPLETED"
        ? "rgb(var(--mr-accent))"
        : "rgb(var(--mr-warn))";
  return (
    <div className="holo pointer-events-none w-[min(420px,92%)] px-3 py-1.5 text-left">
      <div className="flex items-center justify-between gap-2">
        <span className="hud-label">COMMAND</span>
        <span className="mono-xs tracking-[0.18em]" style={{ color: stageColor }}>
          {trace.stage}
        </span>
      </div>
      <div className="mono-xs truncate">{trace.command}</div>
      <div className="hud-label mt-1">UNDERSTANDING</div>
      <div className="mono-xs truncate">{trace.understanding}</div>
      {trace.detail ? <div className="dim mono-xs mt-0.5 truncate">{trace.detail}</div> : null}
    </div>
  );
}

export function ResourceGuardHud() {
  const quality = useStore((s) => s.quality);
  const settings = useStore((s) => s.settings);
  const t = useStore((s) => s.telemetry);
  const reduced = Boolean(
    t &&
      settings.resourceGuard &&
      (t.cpu.usage >= settings.cpuThreshold || t.ram.usedPct >= settings.ramThreshold),
  );

  return (
    <div className="holo flex items-center justify-between gap-2 px-3 py-1.5">
      <span className="hud-label">RESOURCE GUARD</span>
      <span className="flex items-center gap-1.5 text-[10px] tracking-wider">
        <StatusDot state={!settings.resourceGuard ? "off" : reduced ? "warn" : "ok"} />
        {!settings.resourceGuard ? "DISABLED" : reduced ? `THROTTLED · ${quality.toUpperCase()}` : `NOMINAL · ${quality.toUpperCase()}`}
      </span>
    </div>
  );
}
