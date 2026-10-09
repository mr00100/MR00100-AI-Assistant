"use client";

import { bus, useStore, type PanelId } from "./store";
import { playCue } from "./audio";
import { speak, speakableText, stopSpeaking } from "./voice";
import { isApiResponseError, readJsonResponse } from "./safe-json";

let aiAbort: AbortController | null = null;

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function stopAi() {
  aiAbort?.abort();
  aiAbort = null;
  stopSpeaking();
  const st = useStore.getState();
  st.setAiEngine({ status: st.settingsMeta.keyConfigured ? "IDLE" : "OFFLINE", task: "" });
  st.setModule("ai", false);
  st.setAiState("idle", "STANDBY");
}

export function announce(text: string, onEnd?: () => void) {
  const st = useStore.getState();
  if (!st.settings.voiceEnabled || !text) {
    onEnd?.();
    return;
  }
  st.setAiState("speaking", "SPEAKING");
  st.setModule("voice", true);
  bus.emit("AI_SPEAKING", text.slice(0, 80), "info");
  speak(speakableText(text), {
    rate: st.settings.speechRate,
    pitch: st.settings.speechPitch,
    volume: st.settings.speechVolume,
    voiceName: st.settings.voiceName || undefined,
    onLevel: (lvl) => useStore.getState().setMicLevel(lvl),
    onEnd: () => {
      const s = useStore.getState();
      s.setMicLevel(0);
      s.setModule("voice", false);
      if (s.aiState === "speaking") s.setAiState(s.mode === "developer" ? "developer" : "idle", s.mode === "developer" ? "DEVELOPER" : "STANDBY");
      onEnd?.();
    },
  });
}

export async function refreshHistory() {
  try {
    const res = await fetch("/api/history?limit=60");
    const json = (await res.json()) as { ok: boolean; history?: never[] };
    if (json.ok && json.history) useStore.getState().setHistory(json.history);
  } catch {
    /* history panel shows its own empty state */
  }
}

type AiOptions = { task?: "general" | "developer" | "reasoning"; openFile?: string | null; quiet?: boolean };

export async function runAi(prompt: string, opts: AiOptions = {}) {
  const st = useStore.getState();
  const task = opts.task ?? (st.mode === "developer" ? "developer" : "general");
  const id = uid();

  st.pushChat({ id, role: "assistant", content: "", at: Date.now(), streaming: true, mode: task.toUpperCase() });
  st.setAiState("thinking", "PROCESSING");
  st.setModule("ai", true);
  st.setAiEngine({ status: "ACTIVE", task: task === "developer" ? "CODE ANALYSIS" : "REASONING" });
  bus.emit("AI_STARTED", `task=${task}`, "info");

  aiAbort = new AbortController();
  let acc = "";
  try {
    const res = await fetch("/api/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: aiAbort.signal,
      body: JSON.stringify({
        prompt,
        task,
        includeTelemetry: /cpu|ram|memory|disk|network|system|slow|performance/i.test(prompt),
        includeProject: task === "developer",
        openFile: opts.openFile ?? useStore.getState().activeFile,
      }),
    });

    if (!res.headers.get("content-type")?.includes("text/event-stream")) {
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        reason?: string;
        action?: string;
      };
      const err = {
        error: json.error ?? "AI ENGINE FAILURE",
        reason: json.reason ?? "Unknown provider error.",
        action: json.action ?? "Check Settings → AI Provider.",
      };
      useStore.getState().updateChat(id, { streaming: false, error: err, content: "" });
      useStore.getState().setNotice(err);
      useStore.getState().setAiState("error", "ERROR");
      useStore.getState().setAiEngine({ status: "OFFLINE", task: "" });
      playCue("error", st.settings.soundVolume, st.settings.soundEffects);
      bus.emit("AI_FINISHED", err.error, "error");
      return null;
    }

    const reader = res.body?.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let firstToken = true;
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith("data:")) continue;
        try {
          const evt = JSON.parse(line.slice(5).trim()) as {
            type: string;
            content?: string;
            model?: string;
            error?: string;
            reason?: string;
            action?: string;
            durationMs?: number;
          };
          if (evt.type === "start") {
            useStore.getState().setAiEngine({ model: evt.model ?? "", status: "ACTIVE" });
            useStore.getState().updateChat(id, { model: evt.model });
          } else if (evt.type === "delta") {
            if (firstToken) {
              firstToken = false;
              useStore.getState().setAiState("thinking", "GENERATING");
            }
            acc += evt.content ?? "";
            useStore.getState().updateChat(id, { content: acc });
          } else if (evt.type === "error") {
            useStore.getState().setNotice({
              error: evt.error ?? "STREAM ERROR",
              reason: evt.reason ?? "",
              action: evt.action ?? "Retry.",
            });
          } else if (evt.type === "done") {
            bus.emit("AI_FINISHED", `${evt.model} · ${((evt.durationMs ?? 0) / 1000).toFixed(1)}s`, "success");
          }
        } catch {
          /* partial frame */
        }
      }
    }

    useStore.getState().updateChat(id, { streaming: false, content: acc });
    useStore.getState().setAiEngine({ status: "IDLE", task: "" });
    useStore.getState().setModule("ai", false);
    playCue("response", st.settings.soundVolume, st.settings.soundEffects);
    if (!opts.quiet) announce(acc.slice(0, 1200));
    else useStore.getState().setAiState(st.mode === "developer" ? "developer" : "idle", st.mode === "developer" ? "DEVELOPER" : "STANDBY");
    void refreshHistory();
    return acc;
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      useStore.getState().updateChat(id, { streaming: false, content: `${acc}\n\n_[generation stopped by operator]_` });
      useStore.getState().setAiEngine({ status: "IDLE", task: "" });
      useStore.getState().setAiState("idle", "STANDBY");
      return acc;
    }
    const err = {
      error: "AI TRANSPORT FAILURE",
      reason: error instanceof Error ? error.message : "unknown",
      action: "Check network connectivity and retry.",
    };
    useStore.getState().updateChat(id, { streaming: false, error: err });
    useStore.getState().setNotice(err);
    useStore.getState().setAiState("error", "ERROR");
    useStore.getState().setAiEngine({ status: "OFFLINE", task: "" });
    return null;
  } finally {
    aiAbort = null;
  }
}

type CommandResponse = {
  ok: boolean;
  route?: string;
  requiresAi?: boolean;
  requiresConfirmation?: boolean;
  blocked?: boolean;
  intent?: string;
  task?: "general" | "developer" | "reasoning";
  prompt?: string;
  title?: string;
  speak?: string;
  detail?: string;
  error?: string;
  reason?: string;
  action?: string;
  language?: string;
  understanding?: string;
  code?: string;
  trace?: { command: string; language: "en" | "ur" | "roman" | "mixed" | "unknown"; understanding: string; stage: "COMMAND" | "UNDERSTANDING" | "EXECUTING" | "COMPLETED" | "FAILED"; detail: string };
  verdict?: { intentDescription: string; reason: string; affected?: string };
  data?: {
    openPanel?: string;
    setMode?: string;
    runCommand?: string;
    cwd?: string;
    kind?: string;
    url?: string;
    openInBrowserTab?: boolean;
    text?: string;
    useBrowserClipboard?: boolean;
    level?: number;
    applyToUi?: boolean;
    path?: string;
    terminalResult?: {
      command: string;
      cwd: string;
      output: string;
      exitCode: number | null;
      ok: boolean;
    };
    sources?: Array<{ title: string; url: string; snippet: string }>;
    browser?: string;
    playback?: string;
  };
};

type LocalHealth = {
  service?: string;
  running?: boolean;
  database?: { available?: boolean };
  ok?: boolean;
};

async function checkLocalService(): Promise<{ running: boolean; databaseAvailable?: boolean }> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 1800);
  try {
    const response = await fetch("/api/health", {
      cache: "no-store",
      signal: controller.signal,
    });
    const health = await readJsonResponse<LocalHealth>(response, "MR00100 health endpoint");
    return {
      running: health.service === "MR00100" && health.running === true,
      databaseAvailable: health.database?.available,
    };
  } catch {
    return { running: false };
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function executeCommand(
  input: string,
  source: "voice" | "chat" | "dock" = "chat",
  confirmed = false,
) {
  const st = useStore.getState();
  if (!input.trim()) return;

  if (!confirmed) {
    st.pushChat({ id: uid(), role: "user", content: input, at: Date.now() });
  }
  st.setAiState("thinking", "ROUTING");
  st.setCommandTrace({
    command: input,
    language: "unknown",
    understanding: "…",
    stage: "COMMAND",
    detail: "Understanding…",
  });
  playCue("accept", st.settings.soundVolume, st.settings.soundEffects);
  bus.emit("COMMAND_STARTED", input.slice(0, 70), "info");

  let json: CommandResponse;
  try {
    const res = await fetch("/api/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input, source, confirmed }),
    });
    json = await readJsonResponse<CommandResponse>(res, "MR00100 command service");
    if (json.trace) st.setCommandTrace({ ...json.trace, stage: json.trace.stage === "COMPLETED" ? "EXECUTING" : json.trace.stage });
    else if (json.understanding) {
      st.setCommandTrace({
        command: input,
        language: (json.language as "en") ?? "unknown",
        understanding: json.understanding,
        stage: "UNDERSTANDING",
        detail: json.intent ?? "",
      });
    }
  } catch (error) {
    const service = await checkLocalService();
    const message = error instanceof Error ? error.message : "Unknown command transport error.";
    const err = {
      error: isApiResponseError(error)
        ? "INVALID COMMAND RESPONSE"
        : service.running
          ? "COMMAND EXECUTOR FAILURE"
          : "MR00100 SERVICE UNAVAILABLE",
      reason: message,
      action: service.running
        ? service.databaseAvailable === false
          ? "MR00100 is running, but PostgreSQL is unavailable. Check DATABASE_URL and the database service."
          : "MR00100 is reachable; the command endpoint or local executor failed. The HTTP status and response are shown above. Retry after reviewing the error."
        : "MR00100 could not be reached at /api/health. Start the local app with `npm run dev` and retry.",
    };
    st.setNotice(err);
    st.setAiState("error", "ERROR");
    st.setCommandTrace({
      command: input,
      language: "unknown",
      understanding: "COMMAND TRANSPORT",
      stage: "FAILED",
      detail: message,
    });
    st.pushChat({ id: uid(), role: "assistant", content: "", at: Date.now(), error: err });
    return;
  }

  // ------------------------------------------------------- confirmation
  if (json.requiresConfirmation && json.verdict) {
    st.setAiState("warning", "AWAITING AUTHORIZATION");
    playCue("warning", st.settings.soundVolume, st.settings.soundEffects);
    st.setConfirm({
      title: json.intent ?? "ACTION",
      description: json.verdict.intentDescription,
      reason: json.verdict.reason,
      affected: json.verdict.affected,
      onConfirm: () => executeCommand(input, source, true),
    });
    announce(`Authorization required. ${json.verdict.intentDescription}.`);
    return;
  }

  // ------------------------------------------------------------ blocked
  if (json.blocked) {
    const err = {
      error: json.error ?? "ACTION BLOCKED",
      reason: json.reason ?? "",
      action: json.action ?? "Restricted by the security layer.",
    };
    st.setNotice(err);
    st.pushChat({ id: uid(), role: "assistant", content: "", at: Date.now(), error: err });
    st.setAiState("error", "BLOCKED");
    st.setCommandTrace({
      command: input,
      language: (json.language as "en") ?? "unknown",
      understanding: json.understanding ?? json.intent ?? "BLOCKED",
      stage: "FAILED",
      detail: err.reason,
    });
    playCue("error", st.settings.soundVolume, st.settings.soundEffects);
    bus.emit("SECURITY_WARNING", err.reason, "error", true);
    announce("That action is blocked by the security layer.");
    void refreshHistory();
    return;
  }

  // ----------------------------------------------------------- AI route
  if (json.requiresAi) {
    st.togglePanel("chat", true);
    if (json.code === "WEB_RESEARCH_SUMMARY") {
      st.setAiState("searching", "SEARCHING");
      st.setCommandTrace({
        command: input,
        language: (json.language as "en") ?? "unknown",
        understanding: "WEB.RESEARCH",
        stage: "SEARCHING",
        detail: `${((json.data?.sources?.length ?? 0))} live sources retrieved`,
      });
    }
    await runAi(json.prompt ?? input, { task: json.task });
    if (json.code === "WEB_RESEARCH_SUMMARY") {
      useStore.getState().setCommandTrace({
        command: input,
        language: (json.language as "en") ?? "unknown",
        understanding: "WEB.RESEARCH",
        stage: "COMPLETED",
        detail: "Summary delivered with source attribution",
      });
    }
    void refreshHistory();
    return;
  }

  // -------------------------------------------------------- local error
  if (!json.ok) {
    if (json.data?.terminalResult) {
      st.togglePanel("terminal", true);
      st.pushTerminalResult(json.data.terminalResult);
    }
    const err = {
      error: json.error ?? "COMMAND FAILED",
      reason: json.reason ?? "Unknown failure.",
      action: json.action ?? "Rephrase the command or check the target.",
    };
    st.setNotice(err);
    st.pushChat({
      id: uid(),
      role: "assistant",
      content: json.speak ?? "",
      at: Date.now(),
      error: err,
      mode: "LOCAL",
    });
    st.setAiState("error", "ERROR");
    st.setCommandTrace({
      command: input,
      language: (json.language as "en") ?? "unknown",
      understanding: json.understanding ?? json.intent ?? "ERROR",
      stage: "FAILED",
      detail: err.reason,
    });
    playCue("error", st.settings.soundVolume, st.settings.soundEffects);
    if (json.speak) announce(json.speak);
    void refreshHistory();
    return;
  }

  // --------------------------------------------------------- local result
  st.setAiState("executing", json.title ?? "EXECUTING");
  const data = json.data ?? {};
  if (data.terminalResult) {
    st.togglePanel("terminal", true);
    st.pushTerminalResult(data.terminalResult);
  }

  if (data.openPanel) st.togglePanel(data.openPanel as PanelId, true);
  if (data.setMode) {
    if (data.setMode === "developer") st.setMode("developer");
    else if (data.setMode === "mini") st.setMode("mini");
    else st.setMode("command");
  }
  if (data.openInBrowserTab && data.url) window.open(data.url, "_blank", "noopener,noreferrer");
  if (data.useBrowserClipboard && data.text) void navigator.clipboard.writeText(data.text).catch(() => null);
  if (data.applyToUi && typeof data.level === "number") {
    void fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ soundVolume: data.level / 100 }),
    }).catch(() => null);
    st.setSettings({ soundVolume: data.level / 100 });
  }
  if (data.runCommand) {
    st.togglePanel("terminal", true);
    st.requestTerminal({ command: data.runCommand, cwd: data.cwd, kind: data.kind });
  }

  const body = json.speak || json.title || "Done.";
  st.pushChat({
    id: uid(),
    role: "assistant",
    content: body,
    at: Date.now(),
    mode: "LOCAL",
  });
  playCue("complete", st.settings.soundVolume, st.settings.soundEffects);
  bus.emit("COMMAND_FINISHED", json.title ?? input.slice(0, 60), "success");
  st.setCommandTrace({
    command: input,
    language: (json.language as "en") ?? json.trace?.language ?? "unknown",
    understanding: json.understanding ?? json.intent ?? json.title ?? "LOCAL",
    stage: "SUCCESS",
    detail: json.speak ?? json.title ?? "Done.",
  });
  st.setAiState("success", "SUCCESS");
  announce(json.speak ?? "Done.");
  void refreshHistory();
}
