"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useStore } from "@/lib/client/store";

export function Panel({
  title,
  right,
  children,
  className = "",
  scan = true,
  onClose,
}: {
  title: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  scan?: boolean;
  onClose?: () => void;
}) {
  return (
    <section className={`holo relative flex flex-col ${className}`}>
      {scan ? <div className="holo-scan" /> : null}
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-[color:var(--mr-border)] px-3 py-1.5">
        <h2 className="hud-label glow truncate">{title}</h2>
        <div className="flex items-center gap-2">
          {right}
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="btn px-1.5 text-[10px] leading-none"
              aria-label={`Close ${title}`}
            >
              ✕
            </button>
          ) : null}
        </div>
      </header>
      <div className="relative min-h-0 flex-1 overflow-auto">{children}</div>
    </section>
  );
}

export function Bar({
  label,
  value,
  max = 100,
  suffix = "%",
  warnAt = 70,
  dangerAt = 88,
  detail,
}: {
  label: string;
  value: number;
  max?: number;
  suffix?: string;
  warnAt?: number;
  dangerAt?: number;
  detail?: string;
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const cls = pct >= dangerAt ? "danger" : pct >= warnAt ? "warn" : "";
  return (
    <div className={pct >= dangerAt ? "blink" : ""}>
      <div className="flex items-baseline justify-between">
        <span className="hud-label">{label}</span>
        <span className="text-[11px] tabular-nums">
          {value.toFixed(value < 10 ? 1 : 0)}
          <span className="dim">{suffix}</span>
        </span>
      </div>
      <div className="bar-track mt-1">
        <div className={`bar-fill ${cls}`} style={{ width: `${pct}%` }} />
      </div>
      {detail ? <div className="dim mono-xs mt-0.5 truncate">{detail}</div> : null}
    </div>
  );
}

export function StatusDot({ state }: { state: "ok" | "warn" | "err" | "off" }) {
  const color =
    state === "ok"
      ? "rgb(var(--mr-accent))"
      : state === "warn"
        ? "rgb(var(--mr-warn))"
        : state === "err"
          ? "rgb(var(--mr-danger))"
          : "rgba(255,255,255,0.22)";
  return (
    <span
      className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
      style={{ background: color, boxShadow: `0 0 8px ${color}` }}
    />
  );
}

export function Row({
  label,
  value,
  state,
}: {
  label: string;
  value: string;
  state?: "ok" | "warn" | "err" | "off";
}) {
  return (
    <div className="flex items-center justify-between gap-2 py-[3px]">
      <span className="hud-label">{label}</span>
      <span className="flex items-center gap-1.5 text-[10px] tracking-wider">
        {state ? <StatusDot state={state} /> : null}
        {value}
      </span>
    </div>
  );
}

export function ConfirmDialog() {
  const confirm = useStore((s) => s.confirm);
  const setConfirm = useStore((s) => s.setConfirm);
  if (!confirm) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div
        className="holo fade-in w-[min(560px,92vw)] p-4"
        style={{ borderColor: "rgba(var(--mr-warn), 0.55)" }}
      >
        <div className="holo-scan" />
        <div className="flex items-center gap-2">
          <span className="text-lg" style={{ color: "rgb(var(--mr-warn))" }}>
            ⚠
          </span>
          <h3
            className="text-sm tracking-[0.2em]"
            style={{ color: "rgb(var(--mr-warn))" }}
          >
            CONFIRMATION REQUIRED
          </h3>
        </div>
        <p className="mt-3 text-xs leading-relaxed">{confirm.description}</p>
        {confirm.affected ? (
          <pre className="mt-2 max-h-28 overflow-auto border border-[color:var(--mr-border)] bg-black/50 p-2 text-[11px] whitespace-pre-wrap">
            {confirm.affected}
          </pre>
        ) : null}
        <div className="dim mono-xs mt-3">REASON: {confirm.reason}</div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn px-3 py-1.5 text-[11px]" onClick={() => setConfirm(null)}>
            ABORT
          </button>
          <button
            type="button"
            className="btn px-3 py-1.5 text-[11px]"
            style={{ borderColor: "rgba(var(--mr-warn),0.6)", color: "rgb(var(--mr-warn))" }}
            onClick={() => {
              const action = confirm.onConfirm;
              setConfirm(null);
              void action();
            }}
          >
            AUTHORIZE
          </button>
        </div>
      </div>
    </div>
  );
}

export function NoticeToast() {
  const notice = useStore((s) => s.notice);
  const setNotice = useStore((s) => s.setNotice);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 11000);
    return () => clearTimeout(t);
  }, [notice, setNotice]);
  if (!notice) return null;
  return (
    <div className="slide-up fixed bottom-24 left-1/2 z-[70] w-[min(520px,92vw)] -translate-x-1/2">
      <div className="holo p-3" style={{ borderColor: "rgba(var(--mr-danger),0.5)" }}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] tracking-[0.2em]" style={{ color: "rgb(var(--mr-danger))" }}>
              {notice.error}
            </div>
            <div className="mt-1 text-[11px] break-words">{notice.reason}</div>
            <div className="dim mono-xs mt-1">ACTION: {notice.action}</div>
          </div>
          <button type="button" className="btn px-1.5 text-[10px]" onClick={() => setNotice(null)}>
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}

/** Audio-reactive waveform: real mic amplitude when listening, TTS envelope when speaking. */
export function Waveform({ height = 46 }: { height?: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const level = useStore((s) => s.micLevel);
  const aiState = useStore((s) => s.aiState);
  const ref = useRef({ level, aiState });
  useEffect(() => {
    ref.current = { level, aiState };
  }, [level, aiState]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    const history: number[] = new Array(96).fill(0);

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      const rgb =
        getComputedStyle(document.documentElement).getPropertyValue("--mr-accent").trim() ||
        "0,255,170";
      const active = ref.current.aiState === "listening" || ref.current.aiState === "speaking";
      history.push(active ? ref.current.level : Math.max(0, (history[history.length - 1] ?? 0) * 0.86));
      history.shift();

      ctx.clearRect(0, 0, w, h);
      ctx.beginPath();
      const mid = h / 2;
      for (let i = 0; i < history.length; i++) {
        const x = (i / (history.length - 1)) * w;
        const amp = history[i] * (h / 2 - 2);
        const wobble = Math.sin(i * 0.6 + performance.now() / 200) * amp;
        const y = mid + wobble;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `rgba(${rgb}, ${active ? 0.9 : 0.3})`;
      ctx.lineWidth = 1.2;
      ctx.shadowBlur = active ? 8 : 0;
      ctx.shadowColor = `rgba(${rgb}, 0.8)`;
      ctx.stroke();
      ctx.shadowBlur = 0;

      ctx.strokeStyle = `rgba(${rgb}, 0.12)`;
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(0, mid);
      ctx.lineTo(w, mid);
      ctx.stroke();
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} style={{ height }} className="w-full" aria-hidden="true" />;
}
