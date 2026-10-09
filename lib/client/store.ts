"use client";

import { create } from "zustand";
import { DEFAULT_SETTINGS, type AssistantSettings } from "../config";
import type { Telemetry } from "../server/telemetry";
import type { CommandTrace } from "../commands/types";

export type AiState =
  | "idle"
  | "listening"
  | "thinking"
  | "searching"
  | "speaking"
  | "executing"
  | "success"
  | "warning"
  | "error"
  | "developer";

export type PanelId =
  | "chat"
  | "files"
  | "terminal"
  | "system"
  | "security"
  | "settings"
  | "memory"
  | "camera"
  | "history";

export type ModuleId = "voice" | "ai" | "system" | "files" | "network" | "developer";

export type BusEvent = {
  id: number;
  type: string;
  level: "info" | "warn" | "error" | "success";
  message: string;
  at: number;
};

export type HistoryRow = {
  id: number;
  command: string;
  type: string;
  status: string;
  detail?: string | null;
  risk?: string | null;
  durationMs?: number | null;
  createdAt: string;
};

export type ChatEntry = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  model?: string;
  mode?: string;
  at: number;
  streaming?: boolean;
  error?: { error: string; reason: string; action: string };
};

export type PendingConfirm = {
  title: string;
  description: string;
  reason: string;
  affected?: string;
  onConfirm: () => void | Promise<void>;
} | null;

export type ErrorNotice = {
  error: string;
  reason: string;
  action: string;
  at: number;
} | null;

export type AiEngine = {
  status: "OFFLINE" | "IDLE" | "ACTIVE";
  model: string;
  task: string;
};

export type TerminalResult = {
  id: number;
  command: string;
  cwd: string;
  output: string;
  exitCode: number | null;
  ok: boolean;
  at: number;
};

type Store = {
  booted: boolean;
  mode: "command" | "developer" | "mini";
  aiState: AiState;
  stateLabel: string;
  intensity: number; // 0..1 drives globe expansion / brightness
  micLevel: number;
  quality: "high" | "medium" | "low";
  autoQuality: boolean;
  fps: number;

  panels: Record<PanelId, boolean>;
  activeModules: Record<ModuleId, boolean>;

  settings: AssistantSettings;
  settingsMeta: { keyConfigured: boolean; keySource: string; keyMasked: string };
  telemetry: Telemetry | null;
  telemetryError: string | null;

  aiEngine: AiEngine;
  events: BusEvent[];
  history: HistoryRow[];
  chat: ChatEntry[];
  confirm: PendingConfirm;
  notice: ErrorNotice;
  transcript: string;
  workspaceRoot: string;
  activeFile: string | null;
  pendingTerminalCommand: { command: string; cwd?: string; kind?: string } | null;
  terminalResults: TerminalResult[];
  commandTrace: CommandTrace | null;

  setBooted: (v: boolean) => void;
  setMode: (m: Store["mode"]) => void;
  setAiState: (s: AiState, label?: string) => void;
  setIntensity: (v: number) => void;
  setMicLevel: (v: number) => void;
  setQuality: (q: Store["quality"]) => void;
  setFps: (n: number) => void;
  togglePanel: (p: PanelId, open?: boolean) => void;
  setModule: (m: ModuleId, on: boolean) => void;
  setSettings: (s: Partial<AssistantSettings>) => void;
  setSettingsMeta: (m: Store["settingsMeta"]) => void;
  setTelemetry: (t: Telemetry | null, err?: string | null) => void;
  setAiEngine: (e: Partial<AiEngine>) => void;
  pushEvent: (e: Omit<BusEvent, "id" | "at">) => void;
  setHistory: (h: HistoryRow[]) => void;
  pushChat: (e: ChatEntry) => void;
  updateChat: (id: string, patch: Partial<ChatEntry>) => void;
  clearChat: () => void;
  setConfirm: (c: PendingConfirm) => void;
  setNotice: (n: Omit<NonNullable<ErrorNotice>, "at"> | null) => void;
  setTranscript: (t: string) => void;
  setWorkspaceRoot: (r: string) => void;
  setActiveFile: (f: string | null) => void;
  requestTerminal: (c: Store["pendingTerminalCommand"]) => void;
  pushTerminalResult: (result: Omit<TerminalResult, "id" | "at">) => void;
  setCommandTrace: (t: CommandTrace | null) => void;
};

let eventId = 1;
let terminalResultId = 1;

export const useStore = create<Store>((set) => ({
  booted: false,
  mode: "command",
  aiState: "idle",
  stateLabel: "STANDBY",
  intensity: 0,
  micLevel: 0,
  quality: "high",
  autoQuality: true,
  fps: 60,

  panels: {
    chat: false,
    files: false,
    terminal: false,
    system: false,
    security: false,
    settings: false,
    memory: false,
    camera: false,
    history: false,
  },
  activeModules: {
    voice: false,
    ai: false,
    system: true,
    files: false,
    network: true,
    developer: false,
  },

  settings: DEFAULT_SETTINGS,
  settingsMeta: { keyConfigured: false, keySource: "none", keyMasked: "" },
  telemetry: null,
  telemetryError: null,

  aiEngine: { status: "OFFLINE", model: "", task: "" },
  events: [],
  history: [],
  chat: [],
  confirm: null,
  notice: null,
  transcript: "",
  workspaceRoot: "",
  activeFile: null,
  pendingTerminalCommand: null,
  terminalResults: [],
  commandTrace: null,

  setBooted: (v) => set({ booted: v }),
  setMode: (mode) =>
    set((s) => ({
      mode,
      activeModules: { ...s.activeModules, developer: mode === "developer" },
      aiState: mode === "developer" ? "developer" : s.aiState === "developer" ? "idle" : s.aiState,
      stateLabel: mode === "developer" ? "DEVELOPER" : s.stateLabel,
    })),
  setAiState: (aiState, label) =>
    set({
      aiState,
      stateLabel: label ?? aiState.toUpperCase(),
      intensity:
        aiState === "speaking"
          ? 1
          : aiState === "searching"
            ? 0.85
            : aiState === "thinking"
              ? 0.75
              : aiState === "executing"
                ? 0.7
                : aiState === "success"
                  ? 0.6
                  : aiState === "listening"
                    ? 0.55
                    : aiState === "error" || aiState === "warning"
                      ? 0.5
                      : 0.1,
    }),
  setIntensity: (intensity) => set({ intensity }),
  setMicLevel: (micLevel) => set({ micLevel }),
  setQuality: (quality) => set({ quality }),
  setFps: (fps) => set({ fps }),
  togglePanel: (p, open) =>
    set((s) => ({ panels: { ...s.panels, [p]: open ?? !s.panels[p] } })),
  setModule: (m, on) => set((s) => ({ activeModules: { ...s.activeModules, [m]: on } })),
  setSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
  setSettingsMeta: (settingsMeta) => set({ settingsMeta }),
  setTelemetry: (telemetry, telemetryError = null) => set({ telemetry, telemetryError }),
  setAiEngine: (e) => set((s) => ({ aiEngine: { ...s.aiEngine, ...e } })),
  pushEvent: (e) =>
    set((s) => ({
      events: [{ ...e, id: eventId++, at: Date.now() }, ...s.events].slice(0, 60),
    })),
  setHistory: (history) => set({ history }),
  pushChat: (entry) => set((s) => ({ chat: [...s.chat, entry].slice(-120) })),
  updateChat: (id, patch) =>
    set((s) => ({ chat: s.chat.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),
  clearChat: () => set({ chat: [] }),
  setConfirm: (confirm) => set({ confirm }),
  setNotice: (n) => set({ notice: n ? { ...n, at: Date.now() } : null }),
  setTranscript: (transcript) => set({ transcript }),
  setWorkspaceRoot: (workspaceRoot) => set({ workspaceRoot }),
  setActiveFile: (activeFile) => set({ activeFile }),
  requestTerminal: (pendingTerminalCommand) => set({ pendingTerminalCommand }),
  pushTerminalResult: (result) =>
    set((s) => ({
      terminalResults: [...s.terminalResults, { ...result, id: terminalResultId++, at: Date.now() }].slice(-40),
    })),
  setCommandTrace: (commandTrace) => set({ commandTrace }),
}));

/** Central event bus — every module emits here, the UI reacts. */
export const bus = {
  emit(type: string, message: string, level: BusEvent["level"] = "info", persist = false) {
    useStore.getState().pushEvent({ type, message, level });
    if (persist) {
      void fetch("/api/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "event", type, level, message }),
      }).catch(() => null);
    }
  },
};
