"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Panel } from "./ui";
import { bus, useStore } from "@/lib/client/store";
import { playCue } from "@/lib/client/audio";

type Line = { kind: "in" | "out" | "err" | "sys"; text: string };

export default function TerminalPanel({
  className = "",
  onClose,
  title = "INTEGRATED TERMINAL",
}: {
  className?: string;
  onClose?: () => void;
  title?: string;
}) {
  const [lines, setLines] = useState<Line[]>([
    { kind: "sys", text: "MR00100 shell — sandboxed to the workspace root. Type `help` for local intents." },
  ]);
  const [input, setInput] = useState("");
  const [cwd, setCwd] = useState(".");
  const [runId, setRunId] = useState<string | null>(null);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [cmdHistory, setCmdHistory] = useState<string[]>([]);
  const [histIndex, setHistIndex] = useState(-1);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const setConfirm = useStore((s) => s.setConfirm);
  const setNotice = useStore((s) => s.setNotice);
  const setAiState = useStore((s) => s.setAiState);
  const pending = useStore((s) => s.pendingTerminalCommand);
  const requestTerminal = useStore((s) => s.requestTerminal);
  const settings = useStore((s) => s.settings);
  const workspaceRoot = useStore((s) => s.workspaceRoot);
  const terminalResults = useStore((s) => s.terminalResults);
  const consumedResultIds = useRef(new Set<number>());

  const push = useCallback((line: Line) => {
    setLines((prev) => [...prev, line].slice(-600));
  }, []);

  useEffect(() => {
    const pendingResults = terminalResults.filter((result) => !consumedResultIds.current.has(result.id));
    if (!pendingResults.length) return;
    for (const result of pendingResults) {
      consumedResultIds.current.add(result.id);
      setCwd(result.cwd || ".");
      setExitCode(result.exitCode);
      const additions: Line[] = [
        { kind: "in", text: `${result.cwd || "."} $ ${result.command}` },
        ...(result.output ? [{ kind: result.ok ? "out" as const : "err" as const, text: result.output }] : []),
        { kind: result.ok ? "sys" : "err", text: `[exit ${result.exitCode ?? "unknown"}]` },
      ];
      setLines((prev) => [...prev, ...additions].slice(-600));
      bus.emit("TERMINAL_FINISHED", `${result.command} → exit ${result.exitCode ?? "unknown"}`, result.ok ? "success" : "error");
    }
  }, [terminalResults]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const execute = useCallback(
    async (command: string, opts: { cwd?: string; confirmed?: boolean; kind?: string } = {}) => {
      if (!command.trim()) return;
      push({ kind: "in", text: `${opts.cwd ?? cwd} $ ${command}` });
      setExitCode(null);
      setAiState("executing", "EXECUTING");
      bus.emit("TERMINAL_STARTED", command, "info");

      let res: Response;
      try {
        res = await fetch("/api/terminal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command, cwd: opts.cwd ?? cwd, confirmed: opts.confirmed, kind: opts.kind }),
        });
      } catch (error) {
        push({ kind: "err", text: `[MR00100] transport failure: ${String(error)}` });
        setAiState("error", "ERROR");
        return;
      }

      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.includes("text/event-stream")) {
        const json = (await res.json().catch(() => ({}))) as {
          requiresConfirmation?: boolean;
          verdict?: { intentDescription: string; reason: string; affected?: string };
          error?: string;
          reason?: string;
          action?: string;
        };
        if (json.requiresConfirmation && json.verdict) {
          setAiState("warning", "AWAITING AUTHORIZATION");
          playCue("warning", settings.soundVolume, settings.soundEffects);
          setConfirm({
            title: "TERMINAL EXECUTION",
            description: json.verdict.intentDescription,
            reason: json.verdict.reason,
            affected: json.verdict.affected,
            onConfirm: () => execute(command, { ...opts, confirmed: true }),
          });
          push({ kind: "sys", text: `[security] confirmation required: ${json.verdict.reason}` });
          return;
        }
        push({ kind: "err", text: `[${json.error ?? "ERROR"}] ${json.reason ?? "unknown"}` });
        push({ kind: "sys", text: `action: ${json.action ?? "retry"}` });
        setNotice({
          error: json.error ?? "TERMINAL ERROR",
          reason: json.reason ?? "unknown",
          action: json.action ?? "Retry the command.",
        });
        setAiState("error", "ERROR");
        playCue("error", settings.soundVolume, settings.soundEffects);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        push({ kind: "err", text: "[MR00100] no output stream" });
        setAiState("idle", "STANDBY");
        return;
      }
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";
        for (const chunk of chunks) {
          const line = chunk.trim();
          if (!line.startsWith("data:")) continue;
          try {
            const evt = JSON.parse(line.slice(5).trim()) as {
              type: string;
              id?: string;
              data?: string;
              code?: number;
              durationMs?: number;
              error?: string;
              reason?: string;
            };
            if (evt.type === "start") setRunId(evt.id ?? null);
            else if (evt.type === "stdout") push({ kind: "out", text: evt.data ?? "" });
            else if (evt.type === "stderr") push({ kind: "err", text: evt.data ?? "" });
            else if (evt.type === "exit") {
              setRunId(null);
              setExitCode(evt.code ?? -1);
              const ok = evt.code === 0;
              push({
                kind: ok ? "sys" : "err",
                text: `[exit ${evt.code}] ${((evt.durationMs ?? 0) / 1000).toFixed(2)}s`,
              });
              bus.emit(
                "TERMINAL_FINISHED",
                `${command} → exit ${evt.code}`,
                ok ? "success" : "error",
              );
              playCue(ok ? "complete" : "error", settings.soundVolume, settings.soundEffects);
              setAiState(ok ? "idle" : "error", ok ? "STANDBY" : "ERROR");
            }
          } catch {
            /* partial frame */
          }
        }
      }
    },
    [cwd, push, setAiState, setConfirm, setNotice, settings.soundEffects, settings.soundVolume],
  );

  useEffect(() => {
    if (!pending) return;
    const { command, cwd: target, kind } = pending;
    requestTerminal(null);
    if (target) setCwd(target);
    void execute(command, { cwd: target ?? cwd, kind });
  }, [pending, execute, requestTerminal, cwd]);

  const stop = async () => {
    if (!runId) return;
    await fetch(`/api/terminal?id=${runId}`, { method: "DELETE" }).catch(() => null);
    push({ kind: "sys", text: "[MR00100] termination signal sent" });
    setRunId(null);
    setAiState("idle", "STANDBY");
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const value = input.trim();
    if (!value || runId) return;
    if (value === "clear") {
      setLines([]);
      setInput("");
      return;
    }
    if (value.startsWith("cd ")) {
      const next = value.slice(3).trim();
      setCwd(next === ".." ? cwd.split("/").slice(0, -1).join("/") || "." : next);
      push({ kind: "sys", text: `cwd → ${next}` });
      setInput("");
      return;
    }
    setCmdHistory((h) => [value, ...h].slice(0, 60));
    setHistIndex(-1);
    setInput("");
    void execute(value);
  };

  return (
    <Panel
      title={title}
      onClose={onClose}
      className={className}
      right={
        <div className="flex items-center gap-2">
          <span className="dim mono-xs truncate" title={workspaceRoot}>
            {cwd}
          </span>
          {runId ? (
            <span className="mono-xs blink" style={{ color: "rgb(var(--mr-warn))" }}>
              ● RUNNING
            </span>
          ) : exitCode !== null ? (
            <span
              className="mono-xs"
              style={{ color: exitCode === 0 ? "rgb(var(--mr-accent))" : "rgb(var(--mr-danger))" }}
            >
              EXIT {exitCode}
            </span>
          ) : null}
          <button type="button" className="btn px-1.5 text-[10px]" disabled={!runId} onClick={stop}>
            STOP
          </button>
          <button
            type="button"
            className="btn px-1.5 text-[10px]"
            onClick={() => {
              void navigator.clipboard
                .writeText(lines.map((l) => l.text).join(""))
                .catch(() => null);
            }}
          >
            COPY
          </button>
          <button type="button" className="btn px-1.5 text-[10px]" onClick={() => setLines([])}>
            CLEAR
          </button>
        </div>
      }
    >
      <div className="flex h-full flex-col">
        <div ref={scrollRef} className="code-scroll min-h-0 flex-1 overflow-auto p-2 font-mono text-[11px] leading-[1.45]">
          {lines.map((l, i) => (
            <pre
              key={i}
              className="whitespace-pre-wrap break-words"
              style={{
                color:
                  l.kind === "err"
                    ? "rgb(255,120,110)"
                    : l.kind === "in"
                      ? "rgb(var(--mr-accent))"
                      : l.kind === "sys"
                        ? "var(--mr-dim)"
                        : undefined,
              }}
            >
              {l.text}
            </pre>
          ))}
        </div>
        <form onSubmit={submit} className="flex shrink-0 items-center gap-2 border-t border-[color:var(--mr-border)] px-2 py-1.5">
          <span className="accent text-[11px]">❯</span>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowUp") {
                e.preventDefault();
                const next = Math.min(cmdHistory.length - 1, histIndex + 1);
                if (cmdHistory[next]) {
                  setHistIndex(next);
                  setInput(cmdHistory[next]);
                }
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                const next = histIndex - 1;
                setHistIndex(next);
                setInput(next >= 0 ? (cmdHistory[next] ?? "") : "");
              }
            }}
            placeholder={runId ? "process running…" : "node src/index.js"}
            disabled={Boolean(runId)}
            className="min-w-0 flex-1 bg-transparent px-1 py-0.5 text-[11px] outline-none"
            spellCheck={false}
          />
        </form>
      </div>
    </Panel>
  );
}
