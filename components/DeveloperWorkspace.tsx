"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Panel } from "./ui";
import { Highlighted } from "./code";
import FilesPanel, { fsMutate } from "./FilesPanel";
import TerminalPanel from "./TerminalPanel";
import ChatPanel from "./ChatPanel";
import { bus, useStore } from "@/lib/client/store";
import { runAi } from "@/lib/client/pipeline";

type Tab = { path: string; content: string; original: string };

/** Real, local syntax inspection — no fabricated diagnostics. */
function inspect(path: string, content: string): Array<{ line: number; message: string }> {
  const problems: Array<{ line: number; message: string }> = [];
  if (path.endsWith(".json")) {
    try {
      JSON.parse(content);
    } catch (e) {
      const msg = (e as Error).message;
      const posMatch = msg.match(/position (\d+)/);
      let line = 1;
      if (posMatch) line = content.slice(0, Number(posMatch[1])).split("\n").length;
      problems.push({ line, message: msg });
    }
    return problems;
  }
  const stack: Array<{ ch: string; line: number }> = [];
  const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  let line = 1;
  let inStr: string | null = null;
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    const next = content[i + 1];
    if (c === "\n") {
      line++;
      inLineComment = false;
      if (inStr && inStr !== "`") inStr = null;
      continue;
    }
    if (inLineComment) continue;
    if (inBlockComment) {
      if (c === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inStr) {
      if (c === "\\") i++;
      else if (c === inStr) inStr = null;
      continue;
    }
    if (c === "/" && next === "/") {
      inLineComment = true;
      i++;
      continue;
    }
    if (c === "#" && (path.endsWith(".py") || path.endsWith(".sh"))) {
      inLineComment = true;
      continue;
    }
    if (c === "/" && next === "*") {
      inBlockComment = true;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      inStr = c;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") stack.push({ ch: c, line });
    else if (c === ")" || c === "]" || c === "}") {
      const top = stack.pop();
      if (!top || top.ch !== pairs[c]) problems.push({ line, message: `Unbalanced "${c}"` });
    }
  }
  for (const rest of stack) problems.push({ line: rest.line, message: `Unclosed "${rest.ch}"` });
  return problems.slice(0, 20);
}

export default function DeveloperWorkspace() {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [showFind, setShowFind] = useState(false);
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [showExplorer, setShowExplorer] = useState(true);
  const [showAssistant, setShowAssistant] = useState(true);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const preRef = useRef<HTMLPreElement | null>(null);

  const setMode = useStore((s) => s.setMode);
  const setActiveFile = useStore((s) => s.setActiveFile);
  const setNotice = useStore((s) => s.setNotice);
  const setConfirm = useStore((s) => s.setConfirm);
  const requestTerminal = useStore((s) => s.requestTerminal);
  const settings = useStore((s) => s.settings);
  const workspaceRoot = useStore((s) => s.workspaceRoot);
  const events = useStore((s) => s.events);

  const tab = tabs.find((t) => t.path === active) ?? null;
  const problems = useMemo(() => (tab ? inspect(tab.path, tab.content) : []), [tab]);
  const dirty = tab ? tab.content !== tab.original : false;
  const lastBuild = events.find((e) => e.type.startsWith("BUILD_"));

  useEffect(() => {
    setActiveFile(active);
  }, [active, setActiveFile]);

  const openFile = useCallback(
    async (path: string) => {
      const existing = tabs.find((t) => t.path === path);
      if (existing) {
        setActive(path);
        return;
      }
      const res = await fetch(`/api/fs?op=read&path=${encodeURIComponent(path)}`);
      const json = (await res.json()) as {
        ok: boolean;
        file?: { path: string; content: string };
        error?: string;
        reason?: string;
        action?: string;
      };
      if (!json.ok || !json.file) {
        setNotice({
          error: json.error ?? "OPEN FAILED",
          reason: json.reason ?? "",
          action: json.action ?? "Pick another file.",
        });
        return;
      }
      setTabs((prev) => [...prev, { path: json.file!.path, content: json.file!.content, original: json.file!.content }]);
      setActive(json.file.path);
      bus.emit("FILE_OPENED", json.file.path, "info");
    },
    [tabs, setNotice],
  );

  const saveRef = useRef<((confirmed?: boolean) => Promise<void>) | null>(null);
  const save = useCallback(
    async (confirmed = false) => {
      if (!tab) return;
      const json = await fsMutate({ op: "write", path: tab.path, content: tab.content, confirmed });
      if (json.requiresConfirmation && json.verdict) {
        setConfirm({
          title: "OVERWRITE FILE",
          description: json.verdict.intentDescription,
          reason: json.verdict.reason,
          affected: tab.path,
          onConfirm: () => void saveRef.current?.(true),
        });
        return;
      }
      if (!json.ok) {
        setNotice({ error: json.error ?? "SAVE FAILED", reason: json.reason ?? "", action: json.action ?? "Retry." });
        return;
      }
      setTabs((prev) => prev.map((t) => (t.path === tab.path ? { ...t, original: t.content } : t)));
      bus.emit("FILE_CHANGED", `saved ${tab.path}`, "success");
    },
    [tab, setConfirm, setNotice],
  );
  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setShowFind((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  const syncScroll = () => {
    if (taRef.current && preRef.current) {
      preRef.current.scrollTop = taRef.current.scrollTop;
      preRef.current.scrollLeft = taRef.current.scrollLeft;
    }
  };

  const projectDir = tab?.path.includes("/") ? tab.path.split("/")[0] : "demo-project";

  const aiAction = (label: string, instruction: string) => {
    if (!tab) {
      setNotice({ error: "NO ACTIVE FILE", reason: "Open a file before invoking the developer engine.", action: "Select a file in the explorer." });
      return;
    }
    const sel = taRef.current;
    const selected =
      sel && sel.selectionStart !== sel.selectionEnd
        ? tab.content.slice(sel.selectionStart, sel.selectionEnd)
        : "";
    const prompt = `${instruction}\n\nFILE: ${tab.path}\n${
      selected ? `SELECTED REGION:\n\`\`\`\n${selected}\n\`\`\`` : "(whole file is attached in context)"
    }${problems.length ? `\n\nLOCAL SYNTAX CHECK FLAGGED:\n${problems.map((p) => `line ${p.line}: ${p.message}`).join("\n")}` : ""}`;
    bus.emit("AI_STARTED", label, "info");
    void runAi(prompt, { task: "developer", openFile: tab.path, quiet: true });
  };

  const run = (command: string, kind?: string) =>
    requestTerminal({ command, cwd: projectDir, kind });

  const lineCount = tab ? tab.content.split("\n").length : 0;

  return (
    <div className="fixed inset-x-0 top-0 bottom-[58px] z-40 flex flex-col gap-1.5 bg-[rgba(2,6,10,0.86)] p-1.5 backdrop-blur-sm">
      {/* ------------------------------------------------------------ top bar */}
      <div className="holo flex shrink-0 flex-wrap items-center gap-2 px-3 py-1.5">
        <span className="accent glow text-[11px] tracking-[0.25em]">DEVELOPER WORKSPACE</span>
        <span className="dim mono-xs hide-md truncate" title={workspaceRoot}>
          {workspaceRoot}
        </span>
        <span className="mono-xs">
          PROJECT <span className="accent">{projectDir}</span>
        </span>
        <span className="mono-xs truncate">
          FILE <span className="accent">{tab?.path ?? "—"}</span>
          {dirty ? <span style={{ color: "rgb(var(--mr-warn))" }}> ●</span> : null}
        </span>
        <span className="dim mono-xs hide-md">MODEL {settings.developerModel}</span>
        {lastBuild ? (
          <span
            className="mono-xs"
            style={{
              color:
                lastBuild.type === "BUILD_FAILED" ? "rgb(var(--mr-danger))" : "rgb(var(--mr-accent))",
            }}
          >
            {lastBuild.type}
          </span>
        ) : null}
        <div className="ml-auto flex flex-wrap gap-1">
          <button type="button" className="btn px-2 py-1 text-[10px]" onClick={() => run("npm start")}>
            ▶ RUN
          </button>
          <button type="button" className="btn px-2 py-1 text-[10px]" onClick={() => run("npm run build", "build")}>
            BUILD
          </button>
          <button type="button" className="btn px-2 py-1 text-[10px]" onClick={() => run("npm test")}>
            TEST
          </button>
          <button
            type="button"
            className="btn px-2 py-1 text-[10px]"
            onClick={() => aiAction("DEBUG", "Debug this code. Identify the root cause of any defect, then give a corrected version and the exact commands to verify it.")}
          >
            DEBUG
          </button>
          <button type="button" className="btn px-2 py-1 text-[10px]" disabled={!dirty} onClick={() => void save()}>
            SAVE
          </button>
          <button type="button" className="btn px-2 py-1 text-[10px]" onClick={() => setShowExplorer((v) => !v)}>
            EXPLORER
          </button>
          <button type="button" className="btn px-2 py-1 text-[10px]" onClick={() => setShowAssistant((v) => !v)}>
            ASSISTANT
          </button>
          <button type="button" className="btn px-2 py-1 text-[10px]" onClick={() => setMode("command")}>
            ✕ EXIT
          </button>
        </div>
      </div>

      {/* ---------------------------------------------------------- main grid */}
      <div className="flex min-h-0 flex-1 gap-1.5">
        {showExplorer ? (
          <div className="hide-md w-[230px] shrink-0">
            <FilesPanel className="h-full" onOpenFile={(p) => void openFile(p)} />
          </div>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Panel
            title="EDITOR"
            className="min-h-0 flex-1"
            scan={false}
            right={
              <div className="flex items-center gap-2">
                <span className="dim mono-xs">{lineCount} LN</span>
                <span
                  className="mono-xs"
                  style={{ color: problems.length ? "rgb(var(--mr-danger))" : "var(--mr-dim)" }}
                >
                  {problems.length} ISSUE{problems.length === 1 ? "" : "S"}
                </span>
                <button type="button" className="btn px-1.5 py-0.5 text-[9px]" onClick={() => setShowFind((v) => !v)}>
                  FIND
                </button>
              </div>
            }
          >
            <div className="flex h-full min-h-0 flex-col">
              {/* tabs */}
              <div className="flex shrink-0 gap-px overflow-x-auto border-b border-[color:var(--mr-border)] bg-black/30">
                {tabs.length === 0 ? (
                  <span className="dim mono-xs px-2 py-1.5">no open files — select one in the explorer</span>
                ) : null}
                {tabs.map((t) => (
                  <div
                    key={t.path}
                    className={`flex items-center gap-1 border-r border-[color:var(--mr-border)] px-2 py-1 text-[10px] ${
                      t.path === active ? "bg-[rgba(var(--mr-accent),0.12)]" : "opacity-60"
                    }`}
                  >
                    <button type="button" onClick={() => setActive(t.path)} className="max-w-[160px] truncate">
                      {t.path.split("/").pop()}
                      {t.content !== t.original ? " ●" : ""}
                    </button>
                    <button
                      type="button"
                      className="dim hover:text-[rgb(var(--mr-danger))]"
                      onClick={() => {
                        setTabs((prev) => prev.filter((x) => x.path !== t.path));
                        if (active === t.path) setActive(tabs.find((x) => x.path !== t.path)?.path ?? null);
                      }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>

              {showFind ? (
                <div className="flex shrink-0 items-center gap-1 border-b border-[color:var(--mr-border)] p-1">
                  <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="find" className="w-40 px-1.5 py-0.5 text-[10px]" />
                  <input value={replace} onChange={(e) => setReplace(e.target.value)} placeholder="replace" className="w-40 px-1.5 py-0.5 text-[10px]" />
                  <button
                    type="button"
                    className="btn px-1.5 py-0.5 text-[9px]"
                    onClick={() => {
                      if (!tab || !find) return;
                      const count = tab.content.split(find).length - 1;
                      setTabs((prev) =>
                        prev.map((t) => (t.path === tab.path ? { ...t, content: t.content.split(find).join(replace) } : t)),
                      );
                      bus.emit("EDITOR_REPLACE", `${count} occurrence(s) replaced`, "info");
                    }}
                  >
                    REPLACE ALL
                  </button>
                  <span className="dim mono-xs">
                    {tab && find ? `${tab.content.split(find).length - 1} matches` : ""}
                  </span>
                </div>
              ) : null}

              {/* editor surface */}
              <div className="relative min-h-0 flex-1 overflow-hidden">
                {tab ? (
                  <div className="flex h-full">
                    <div className="code-scroll w-10 shrink-0 overflow-hidden border-r border-[color:var(--mr-border)] bg-black/40 py-2 text-right">
                      {Array.from({ length: lineCount }, (_, i) => {
                        const bad = problems.some((p) => p.line === i + 1);
                        return (
                          <div
                            key={i}
                            className="mono-xs pr-1.5 leading-[18px]"
                            style={{ color: bad ? "rgb(var(--mr-danger))" : "var(--mr-dim)" }}
                          >
                            {bad ? "●" : i + 1}
                          </div>
                        );
                      })}
                    </div>
                    <div className="relative min-w-0 flex-1">
                      <pre
                        ref={preRef}
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-0 overflow-auto p-2 font-mono text-[12px] leading-[18px] whitespace-pre"
                      >
                        <Highlighted code={tab.content} />
                      </pre>
                      <textarea
                        ref={taRef}
                        value={tab.content}
                        spellCheck={false}
                        onScroll={syncScroll}
                        onChange={(e) =>
                          setTabs((prev) => prev.map((t) => (t.path === tab.path ? { ...t, content: e.target.value } : t)))
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Tab") {
                            e.preventDefault();
                            const ta = e.currentTarget;
                            const start = ta.selectionStart;
                            const value = `${tab.content.slice(0, start)}  ${tab.content.slice(ta.selectionEnd)}`;
                            setTabs((prev) => prev.map((t) => (t.path === tab.path ? { ...t, content: value } : t)));
                            requestAnimationFrame(() => {
                              ta.selectionStart = ta.selectionEnd = start + 2;
                            });
                          }
                        }}
                        className="absolute inset-0 resize-none border-0 bg-transparent p-2 font-mono text-[12px] leading-[18px] whitespace-pre text-transparent caret-[rgb(var(--mr-accent))] outline-none"
                        style={{ WebkitTextFillColor: "transparent" }}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="dim mono-xs p-3">
                    MR00100 developer surface idle. Open a file to begin analysis.
                  </div>
                )}
              </div>

              {problems.length ? (
                <div className="shrink-0 border-t border-[rgba(var(--mr-danger),0.4)] bg-[rgba(var(--mr-danger),0.05)] p-1.5">
                  <div className="hud-label mb-0.5" style={{ color: "rgb(var(--mr-danger))" }}>
                    LOCAL SYNTAX CHECK
                  </div>
                  {problems.slice(0, 4).map((p, i) => (
                    <div key={i} className="mono-xs">
                      line {p.line}: {p.message}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </Panel>

          <div className="h-[34%] min-h-[150px]">
            <TerminalPanel className="h-full" title="TERMINAL" />
          </div>
        </div>

        {showAssistant ? (
          <div className="hide-md flex w-[330px] shrink-0 flex-col gap-1.5">
            <Panel title="AI TASKS" className="shrink-0">
              <div className="grid grid-cols-2 gap-1 p-2">
                {[
                  ["EXPLAIN", "Explain what this file does, its responsibilities and its data flow."],
                  ["FIND BUGS", "Review this file for defects, edge cases and security issues. List them by severity."],
                  ["REFACTOR", "Refactor this file for clarity and performance. Preserve behaviour and show the full updated file."],
                  ["TESTS", "Generate a complete test suite for this file, including edge cases."],
                  ["DOCS", "Write documentation for this file: purpose, API, usage examples."],
                  ["ARCHITECT", "Analyse this project's architecture from the workspace tree and propose concrete improvements."],
                ].map(([label, instruction]) => (
                  <button
                    key={label}
                    type="button"
                    className="btn px-2 py-1.5 text-[10px]"
                    onClick={() => aiAction(label, instruction)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="dim mono-xs border-t border-[color:var(--mr-border)] p-2 leading-relaxed">
                Context sent: active file, workspace tree, local syntax findings. Nothing else leaves
                the machine.
              </div>
            </Panel>
            <ChatPanel className="min-h-0 flex-1" />
          </div>
        ) : null}
      </div>
    </div>
  );
}
