"use client";

import { useStore, type PanelId } from "@/lib/client/store";
import { playCue } from "@/lib/client/audio";

const ITEMS: Array<{ id: PanelId | "mic" | "developer"; label: string; glyph: string }> = [
  { id: "mic", label: "MIC", glyph: "◉" },
  { id: "chat", label: "CHAT", glyph: "▤" },
  { id: "files", label: "FILES", glyph: "▣" },
  { id: "terminal", label: "TERM", glyph: "❯" },
  { id: "developer", label: "DEV", glyph: "⌘" },
  { id: "system", label: "SYS", glyph: "▥" },
  { id: "security", label: "SEC", glyph: "⛨" },
  { id: "memory", label: "MEM", glyph: "◈" },
  { id: "camera", label: "CAM", glyph: "◎" },
  { id: "history", label: "LOG", glyph: "≡" },
  { id: "settings", label: "CFG", glyph: "⚙" },
];

export default function Dock({
  onMic,
  voiceActive,
  listening,
}: {
  onMic: () => void;
  voiceActive: boolean;
  listening: boolean;
}) {
  const panels = useStore((s) => s.panels);
  const togglePanel = useStore((s) => s.togglePanel);
  const setMode = useStore((s) => s.setMode);
  const mode = useStore((s) => s.mode);
  const settings = useStore((s) => s.settings);

  return (
    <nav className="pointer-events-auto flex shrink-0 justify-center">
      <div className="holo flex items-end gap-1 px-2 py-1.5">
        {ITEMS.map((item) => {
          const active =
            item.id === "mic"
              ? voiceActive
              : item.id === "developer"
                ? mode === "developer"
                : panels[item.id as PanelId];
          return (
            <button
              key={item.id}
              type="button"
              title={item.label}
              onClick={() => {
                playCue("click", settings.soundVolume, settings.soundEffects);
                if (item.id === "mic") onMic();
                else if (item.id === "developer") setMode(mode === "developer" ? "command" : "developer");
                else togglePanel(item.id as PanelId);
              }}
              className="group relative flex w-[52px] flex-col items-center gap-0.5 px-1 py-1 transition-transform hover:-translate-y-0.5"
              style={{
                background: active ? "rgba(var(--mr-accent),0.14)" : "transparent",
                border: `1px solid ${active ? "rgba(var(--mr-accent),0.55)" : "transparent"}`,
                boxShadow: active ? "0 0 18px -6px rgba(var(--mr-accent),0.8)" : undefined,
              }}
            >
              <span
                className={`text-[15px] leading-none ${item.id === "mic" && voiceActive ? "blink" : ""}`}
                style={{ color: active ? "rgb(var(--mr-accent))" : "var(--mr-dim)" }}
              >
                {item.glyph}
              </span>
              <span
                className="text-[8px] tracking-[0.14em]"
                style={{ color: active ? "rgb(var(--mr-accent))" : "var(--mr-dim)" }}
              >
                {item.id === "mic" ? (voiceActive ? (listening ? "LISTEN" : "ACTIVE") : "MIC OFF") : item.label}
              </span>
              <span
                className="absolute -bottom-0.5 h-[2px] w-4 transition-all"
                style={{
                  background: active ? "rgb(var(--mr-accent))" : "transparent",
                  boxShadow: active ? "0 0 8px rgb(var(--mr-accent))" : undefined,
                }}
              />
            </button>
          );
        })}
      </div>
    </nav>
  );
}
