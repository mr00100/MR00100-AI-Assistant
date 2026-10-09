"use client";

import { useEffect, useRef, useState } from "react";
import { Panel } from "./ui";
import { CodeBlock, parseSegments, RichText } from "./code";
import { useStore } from "@/lib/client/store";
import { executeCommand, runAi, stopAi } from "@/lib/client/pipeline";
import { fsMutate } from "./FilesPanel";

export default function ChatPanel({
  onClose,
  className = "",
}: {
  onClose?: () => void;
  className?: string;
}) {
  const chat = useStore((s) => s.chat);
  const clearChat = useStore((s) => s.clearChat);
  const aiEngine = useStore((s) => s.aiEngine);
  const setNotice = useStore((s) => s.setNotice);
  const setConfirm = useStore((s) => s.setConfirm);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const streaming = chat.some((c) => c.streaming);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat]);

  const saveCode = async (path: string, content: string, confirmed = false) => {
    const json = await fsMutate({ op: "write", path, content, confirmed });
    if (json.requiresConfirmation && json.verdict) {
      setConfirm({
        title: "WRITE FILE",
        description: json.verdict.intentDescription,
        reason: json.verdict.reason,
        affected: path,
        onConfirm: () => saveCode(path, content, true),
      });
      return;
    }
    if (!json.ok) {
      setNotice({
        error: json.error ?? "WRITE FAILED",
        reason: json.reason ?? "",
        action: json.action ?? "Retry.",
      });
      return;
    }
    setNotice({ error: "FILE WRITTEN", reason: `${path} saved to workspace.`, action: "Open it from the file explorer." });
  };

  const lastUser = [...chat].reverse().find((c) => c.role === "user");

  return (
    <Panel
      title="CHAT INTERFACE"
      onClose={onClose}
      className={className}
      right={
        <div className="flex items-center gap-1">
          <span className="dim mono-xs hide-md">{aiEngine.model || "local"}</span>
          {streaming ? (
            <button type="button" className="btn px-1.5 py-0.5 text-[9px]" onClick={stopAi}>
              STOP
            </button>
          ) : (
            <button
              type="button"
              className="btn px-1.5 py-0.5 text-[9px]"
              disabled={!lastUser}
              onClick={() => lastUser && void runAi(lastUser.content)}
            >
              REGEN
            </button>
          )}
          <button type="button" className="btn px-1.5 py-0.5 text-[9px]" onClick={clearChat}>
            CLEAR
          </button>
        </div>
      }
    >
      <div className="flex h-full min-h-0 flex-col">
        <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
          {chat.length === 0 ? (
            <div className="dim mono-xs space-y-1">
              <div>MR00100 AI :: command channel open.</div>
              <div>Local intents run with zero model cost. Cognitive requests wake the AI engine.</div>
              <div className="pt-2">Try: &ldquo;check my CPU usage&rdquo; · &ldquo;create a python file&rdquo; · &ldquo;explain this project architecture&rdquo;</div>
            </div>
          ) : null}
          {chat.map((m) => (
            <div key={m.id} className="fade-in">
              <div className="hud-label mb-1 flex items-center gap-2">
                <span style={{ color: m.role === "user" ? "var(--mr-dim)" : "rgb(var(--mr-accent))" }}>
                  {m.role === "user" ? "OPERATOR" : "MR00100"}
                </span>
                {m.mode ? <span className="dim">{m.mode}</span> : null}
                {m.model ? <span className="dim hide-md">{m.model}</span> : null}
                <span className="dim">{new Date(m.at).toLocaleTimeString()}</span>
                {m.streaming ? <span className="accent blink">▊</span> : null}
              </div>
              {m.error ? (
                <div className="border border-[rgba(var(--mr-danger),0.4)] bg-[rgba(var(--mr-danger),0.06)] p-2">
                  <div className="text-[11px]" style={{ color: "rgb(var(--mr-danger))" }}>
                    {m.error.error}
                  </div>
                  <div className="mt-1 text-[11px]">{m.error.reason}</div>
                  <div className="dim mono-xs mt-1">ACTION: {m.error.action}</div>
                </div>
              ) : (
                <div
                  className={
                    m.role === "user"
                      ? "border-l-2 border-[color:var(--mr-border)] pl-2 text-[12px] opacity-80"
                      : ""
                  }
                >
                  {parseSegments(m.content).map((seg, i) =>
                    seg.kind === "code" ? (
                      <CodeBlock
                        key={i}
                        code={seg.value}
                        lang={seg.lang}
                        filePath={seg.path}
                        onSave={(p, c) => void saveCode(p, c)}
                      />
                    ) : (
                      <RichText key={i} value={seg.value} />
                    ),
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        <form
          className="flex shrink-0 items-end gap-2 border-t border-[color:var(--mr-border)] p-2"
          onSubmit={(e) => {
            e.preventDefault();
            const value = input.trim();
            if (!value) return;
            setInput("");
            void executeCommand(value, "chat");
          }}
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                const value = input.trim();
                if (!value) return;
                setInput("");
                void executeCommand(value, "chat");
              }
            }}
            rows={2}
            placeholder="MR00100, …"
            className="min-h-[38px] flex-1 resize-none px-2 py-1.5 text-[12px]"
          />
          <button type="submit" className="btn px-3 py-2 text-[10px]" disabled={!input.trim()}>
            SEND
          </button>
        </form>
      </div>
    </Panel>
  );
}
