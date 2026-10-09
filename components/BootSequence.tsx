"use client";

import { useEffect, useRef, useState } from "react";
import { playCue } from "@/lib/client/audio";
import { useStore } from "@/lib/client/store";

type Step = { label: string; run?: () => Promise<string> };

export default function BootSequence({ onDone }: { onDone: () => void }) {
  const [lines, setLines] = useState<Array<{ text: string; status: string; ok: boolean }>>([]);
  const [progress, setProgress] = useState(0);
  const [finished, setFinished] = useState(false);
  const settings = useStore((s) => s.settings);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    playCue("startup", settings.soundVolume, settings.soundEffects);

    const steps: Step[] = [
      {
        label: "INITIALIZING MR00100 CORE",
        run: async () => {
          const res = await fetch("/api/health");
          const json = (await res.json()) as { ok: boolean };
          if (!json.ok) throw new Error("database unreachable");
          return "ONLINE";
        },
      },
      {
        label: "LOADING VOICE ENGINE",
        run: async () => {
          const w = window as unknown as { webkitSpeechRecognition?: unknown; SpeechRecognition?: unknown };
          const stt = Boolean(w.SpeechRecognition ?? w.webkitSpeechRecognition);
          const tts = typeof window.speechSynthesis !== "undefined";
          if (!tts) throw new Error("speech synthesis unavailable");
          return stt ? "READY" : "TTS ONLY";
        },
      },
      {
        label: "LOADING SYSTEM INTERFACE",
        run: async () => {
          const res = await fetch("/api/system/stats?processes=0");
          const json = (await res.json()) as { ok: boolean; telemetry?: { cpu: { cores: number } } };
          if (!json.ok) throw new Error("telemetry offline");
          return `${json.telemetry?.cpu.cores ?? "?"} CORES`;
        },
      },
      {
        label: "INITIALIZING SECURITY LAYER",
        run: async () => {
          const res = await fetch("/api/settings");
          const json = (await res.json()) as { ok: boolean; settings?: { terminalAccess: string } };
          if (!json.ok) throw new Error("policy store unreachable");
          return "ACTIVE";
        },
      },
      {
        label: "CONNECTING AI SERVICES",
        run: async () => {
          const res = await fetch("/api/ai/models");
          const json = (await res.json()) as { ok: boolean; keyConfigured?: boolean; models?: string[] };
          if (!json.keyConfigured) return "STANDBY · NO KEY";
          return `${json.models?.length ?? 0} MODELS`;
        },
      },
      {
        label: "MOUNTING WORKSPACE",
        run: async () => {
          const res = await fetch("/api/fs?op=list&path=.");
          const json = (await res.json()) as { ok: boolean; entries?: unknown[] };
          if (!json.ok) throw new Error("workspace mount failed");
          return `${json.entries?.length ?? 0} ENTRIES`;
        },
      },
      { label: "PC CONTROL LAYER", run: async () => "READY" },
      { label: "DEVELOPER MODE", run: async () => "READY" },
    ];

    let cancelled = false;
    (async () => {
      for (let i = 0; i < steps.length; i++) {
        if (cancelled) return;
        const step = steps[i];
        setLines((prev) => [...prev, { text: step.label, status: "…", ok: true }]);
        let status = "OK";
        let ok = true;
        try {
          status = (await step.run?.()) ?? "OK";
        } catch (e) {
          status = `FAILED · ${e instanceof Error ? e.message : "error"}`;
          ok = false;
        }
        if (cancelled) return;
        setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, status, ok } : l)));
        setProgress(Math.round(((i + 1) / steps.length) * 100));
        await new Promise((r) => setTimeout(r, 170));
      }
      if (cancelled) return;
      setFinished(true);
      playCue("complete", settings.soundVolume, settings.soundEffects);
      setTimeout(onDone, 1250);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-[90] flex flex-col items-center justify-center bg-[#02060a]">
      <div className="w-[min(680px,92vw)]">
        <div className="mb-6 text-center">
          <div className="glitch text-[clamp(28px,6vw,64px)] leading-none tracking-[0.3em]">
            <span className="accent glow">MR00100</span>
            <span className="dim"> AI</span>
          </div>
          <div className="hud-label mt-2">YOUR SYSTEM. YOUR COMMAND.</div>
        </div>

        <div className="holo p-4">
          <div className="holo-scan" />
          <div className="space-y-1">
            {lines.map((l, i) => (
              <div key={i} className="mono-xs flex justify-between gap-3">
                <span>{l.text}…</span>
                <span
                  style={{
                    color: !l.ok
                      ? "rgb(var(--mr-danger))"
                      : l.status === "…"
                        ? "var(--mr-dim)"
                        : "rgb(var(--mr-accent))",
                  }}
                >
                  {l.status}
                </span>
              </div>
            ))}
          </div>
          <div className="bar-track mt-4">
            <div className="bar-fill" style={{ width: `${progress}%` }} />
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="dim mono-xs">{progress}%</span>
            {finished ? (
              <span className="accent glow text-[13px] tracking-[0.32em]">SYSTEM ONLINE</span>
            ) : (
              <span className="dim mono-xs blink">BOOTSTRAPPING</span>
            )}
          </div>
        </div>

        <div className="mt-4 text-center">
          <button type="button" className="btn px-4 py-1.5 text-[10px]" onClick={onDone}>
            SKIP →
          </button>
        </div>
      </div>
    </div>
  );
}
