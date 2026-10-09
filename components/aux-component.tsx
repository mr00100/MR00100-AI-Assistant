"use client";

import { useEffect, useRef, useState } from "react";
import { Panel, Row } from "./ui";
import { bus, useStore } from "@/lib/client/store";
import { runAi } from "@/lib/client/pipeline";

type MemoryRow = {
  id: number;
  category: string;
  key: string;
  value: string;
  pinned: boolean;
  updatedAt: string;
};

export function MemoryPanel({ onClose, className = "" }: { onClose?: () => void; className?: string }) {
  const [rows, setRows] = useState<MemoryRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({ category: "preference", key: "", value: "" });
  const setNotice = useStore((s) => s.setNotice);
  const setConfirm = useStore((s) => s.setConfirm);
  const memoryEnabled = useStore((s) => s.settings.memoryEnabled);

  const load = async () => {
    const res = await fetch("/api/memory").catch(() => null);
    if (!res) {
      setError("MEMORY SERVICE UNREACHABLE");
      return;
    }
    const json = (await res.json()) as { ok: boolean; entries?: MemoryRow[]; error?: string; reason?: string };
    if (!json.ok) {
      setError(`${json.error}: ${json.reason}`);
      return;
    }
    setRows(json.entries ?? []);
    setError(null);
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const add = async () => {
    if (!draft.key.trim() || !draft.value.trim()) return;
    const res = await fetch("/api/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    const json = (await res.json()) as { ok: boolean; error?: string; reason?: string; action?: string };
    if (!json.ok) {
      setNotice({ error: json.error ?? "MEMORY WRITE FAILED", reason: json.reason ?? "", action: json.action ?? "Retry." });
      return;
    }
    setDraft({ category: draft.category, key: "", value: "" });
    bus.emit("MEMORY_WRITE", draft.key, "success");
    void load();
  };

  return (
    <Panel
      title="LOCAL MEMORY"
      onClose={onClose}
      className={className}
      right={
        <button
          type="button"
          className="btn btn-danger px-1.5 py-0.5 text-[9px]"
          onClick={() =>
            setConfirm({
              title: "CLEAR MEMORY",
              description: "Erase every stored memory entry. This cannot be undone.",
              reason: "Destructive operation on local operator memory.",
              onConfirm: async () => {
                await fetch("/api/memory?id=all", { method: "DELETE" });
                void load();
              },
            })
          }
        >
          CLEAR ALL
        </button>
      }
    >
      <div className="p-2">
        {!memoryEnabled ? (
          <div className="mono-xs mb-2" style={{ color: "rgb(var(--mr-warn))" }}>
            Memory is disabled in Settings — stored entries are not sent to the AI engine.
          </div>
        ) : null}
        {error ? (
          <div className="mono-xs mb-2" style={{ color: "rgb(var(--mr-danger))" }}>
            {error}
          </div>
        ) : null}

        <div className="mb-2 flex flex-wrap gap-1">
          <input
            value={draft.category}
            onChange={(e) => setDraft({ ...draft, category: e.target.value })}
            placeholder="category"
            className="w-24 px-1.5 py-0.5 text-[10px]"
          />
          <input
            value={draft.key}
            onChange={(e) => setDraft({ ...draft, key: e.target.value })}
            placeholder="key"
            className="w-28 px-1.5 py-0.5 text-[10px]"
          />
          <input
            value={draft.value}
            onChange={(e) => setDraft({ ...draft, value: e.target.value })}
            placeholder="value"
            className="min-w-0 flex-1 px-1.5 py-0.5 text-[10px]"
          />
          <button type="button" className="btn px-2 py-0.5 text-[9px]" onClick={() => void add()}>
            STORE
          </button>
        </div>

        {rows.length === 0 ? (
          <div className="dim mono-xs">No memory stored. MR00100 only remembers what you tell it to.</div>
        ) : (
          rows.map((r) => (
            <div key={r.id} className="flex items-start gap-2 border-b border-white/5 py-1">
              <button
                type="button"
                className="mono-xs"
                title="pin"
                style={{ color: r.pinned ? "rgb(var(--mr-accent))" : "var(--mr-dim)" }}
                onClick={async () => {
                  await fetch("/api/memory", {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ id: r.id, pinned: !r.pinned }),
                  });
                  void load();
                }}
              >
                ★
              </button>
              <div className="min-w-0 flex-1">
                <div className="mono-xs">
                  <span className="dim">[{r.category}]</span> <span className="accent">{r.key}</span>
                </div>
                <div className="mono-xs break-words">{r.value}</div>
              </div>
              <button
                type="button"
                className="mono-xs dim hover:text-[rgb(var(--mr-danger))]"
                onClick={async () => {
                  await fetch(`/api/memory?id=${r.id}`, { method: "DELETE" });
                  void load();
                }}
              >
                ✕
              </button>
            </div>
          ))
        )}
      </div>
    </Panel>
  );
}

export function CameraPanel({ onClose, className = "" }: { onClose?: () => void; className?: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shot, setShot] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stop = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setActive(false);
    bus.emit("CAMERA_STOPPED", "vision module offline", "info");
  };

  useEffect(() => stop, []);

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setActive(true);
      setError(null);
      bus.emit("CAMERA_STARTED", "vision module online (local only)", "warn");
    } catch (e) {
      setError(
        `Camera permission denied or no device available (${e instanceof Error ? e.message : "unknown"}).`,
      );
    }
  };

  const capture = () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    setShot(canvas.toDataURL("image/jpeg", 0.7));
  };

  return (
    <Panel title="VISION MODULE" onClose={onClose} className={className}>
      <div className="space-y-2 p-2">
        <Row label="CAMERA" value={active ? "ACTIVE" : "OFF"} state={active ? "warn" : "off"} />
        <div className="dim mono-xs leading-relaxed">
          The camera never activates silently. Frames stay in the browser unless you explicitly send a
          captured frame for analysis.
        </div>
        {error ? (
          <div className="mono-xs" style={{ color: "rgb(var(--mr-danger))" }}>
            {error}
          </div>
        ) : null}
        <div className="relative aspect-video w-full border border-[color:var(--mr-border)] bg-black/60">
          <video ref={videoRef} muted playsInline className="h-full w-full object-cover opacity-90" />
          {!active ? (
            <div className="dim mono-xs absolute inset-0 flex items-center justify-center">NO SIGNAL</div>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-1">
          {!active ? (
            <button type="button" className="btn px-2 py-1 text-[10px]" onClick={() => void start()}>
              ENABLE CAMERA
            </button>
          ) : (
            <>
              <button type="button" className="btn px-2 py-1 text-[10px]" onClick={capture}>
                CAPTURE FRAME
              </button>
              <button type="button" className="btn btn-danger px-2 py-1 text-[10px]" onClick={stop}>
                DISABLE
              </button>
            </>
          )}
          {shot ? (
            <button
              type="button"
              className="btn px-2 py-1 text-[10px]"
              onClick={() =>
                void runAi(
                  "I captured a webcam frame locally. Describe what analysis you could perform if I enable a vision-capable model, and list exactly what data would be transmitted.",
                  { task: "general" },
                )
              }
            >
              ASK ABOUT FRAME
            </button>
          ) : null}
        </div>
        {shot ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shot} alt="captured frame" className="w-full border border-[color:var(--mr-border)]" />
        ) : null}
      </div>
    </Panel>
  );
}
