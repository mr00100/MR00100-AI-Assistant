"use client";

import { useCallback, useEffect, useState } from "react";
import { Panel } from "./ui";
import { bus, useStore } from "@/lib/client/store";

export type Entry = {
  name: string;
  path: string;
  type: "file" | "dir";
  size: number;
  modified: string;
  ext: string;
};

function fmtSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function useWorkspace() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [recent, setRecent] = useState<Entry[]>([]);
  const [path, setPath] = useState(".");
  const [error, setError] = useState<string | null>(null);
  const setWorkspaceRoot = useStore((s) => s.setWorkspaceRoot);

  const load = useCallback(
    async (target = path) => {
      try {
        const res = await fetch(`/api/fs?op=list&path=${encodeURIComponent(target)}`);
        const json = (await res.json()) as {
          ok: boolean;
          entries?: Entry[];
          root?: string;
          error?: string;
          reason?: string;
        };
        if (!json.ok) {
          setError(`${json.error}: ${json.reason}`);
          return;
        }
        setEntries(json.entries ?? []);
        setPath(target);
        setError(null);
        if (json.root) setWorkspaceRoot(json.root);
      } catch (e) {
        setError(`FILESYSTEM UNREACHABLE: ${String(e)}`);
      }
    },
    [path, setWorkspaceRoot],
  );

  const loadRecent = useCallback(async () => {
    const res = await fetch("/api/fs?op=recent").catch(() => null);
    if (!res) return;
    const json = (await res.json()) as { ok: boolean; entries?: Entry[] };
    if (json.ok) setRecent(json.entries ?? []);
  }, []);

  useEffect(() => {
    void load(".");
    void loadRecent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { entries, recent, path, error, load, loadRecent, setEntries };
}

export async function fsMutate(body: Record<string, unknown>) {
  const res = await fetch("/api/fs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as {
    ok: boolean;
    requiresConfirmation?: boolean;
    verdict?: { intentDescription: string; reason: string; affected?: string };
    error?: string;
    reason?: string;
    action?: string;
    result?: Record<string, unknown>;
  };
}

export default function FilesPanel({
  onOpenFile,
  onClose,
  className = "",
}: {
  onOpenFile?: (path: string) => void;
  onClose?: () => void;
  className?: string;
}) {
  const { entries, recent, path, error, load, loadRecent } = useWorkspace();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Entry[] | null>(null);
  const [selected, setSelected] = useState<Entry | null>(null);
  const setConfirm = useStore((s) => s.setConfirm);
  const setNotice = useStore((s) => s.setNotice);
  const setModule = useStore((s) => s.setModule);
  const workspaceRoot = useStore((s) => s.workspaceRoot);

  useEffect(() => {
    setModule("files", true);
    return () => setModule("files", false);
  }, [setModule]);

  const search = async () => {
    if (!query.trim()) {
      setResults(null);
      return;
    }
    const res = await fetch(`/api/fs?op=search&q=${encodeURIComponent(query)}`);
    const json = (await res.json()) as { ok: boolean; entries?: Entry[]; error?: string; reason?: string; action?: string };
    if (!json.ok) {
      setNotice({ error: json.error ?? "SEARCH FAILED", reason: json.reason ?? "", action: json.action ?? "Retry." });
      return;
    }
    setResults(json.entries ?? []);
  };

  const handle = async (body: Record<string, unknown>, label: string) => {
    const json = await fsMutate(body);
    if (json.requiresConfirmation && json.verdict) {
      setConfirm({
        title: label,
        description: json.verdict.intentDescription,
        reason: json.verdict.reason,
        affected: json.verdict.affected,
        onConfirm: () => handle({ ...body, confirmed: true }, label),
      });
      return;
    }
    if (!json.ok) {
      setNotice({ error: json.error ?? "OPERATION FAILED", reason: json.reason ?? "", action: json.action ?? "Retry." });
      bus.emit("FILE_ERROR", `${label}: ${json.reason ?? ""}`, "error");
      return;
    }
    bus.emit(label.includes("DELETE") ? "FILE_CHANGED" : "FILE_CREATED", `${label} ok`, "success");
    await load(path);
    await loadRecent();
  };

  const list = results ?? entries;
  const parent = path === "." ? null : path.split("/").slice(0, -1).join("/") || ".";

  return (
    <Panel
      title="FILE INTELLIGENCE"
      onClose={onClose}
      className={className}
      right={<span className="dim mono-xs truncate max-w-[220px]" title={workspaceRoot}>{workspaceRoot || "…"}</span>}
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-center gap-1 border-b border-[color:var(--mr-border)] p-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void search()}
            placeholder="search workspace…"
            className="min-w-0 flex-1 px-2 py-1 text-[11px]"
          />
          <button type="button" className="btn px-2 py-1 text-[10px]" onClick={() => void search()}>
            FIND
          </button>
          {results ? (
            <button type="button" className="btn px-2 py-1 text-[10px]" onClick={() => { setResults(null); setQuery(""); }}>
              CLR
            </button>
          ) : null}
          <button
            type="button"
            className="btn px-2 py-1 text-[10px]"
            onClick={() => {
              const name = window.prompt("New file path (relative to workspace):");
              if (name) void handle({ op: "create", path: name, content: "" }, "CREATE FILE");
            }}
          >
            +FILE
          </button>
          <button
            type="button"
            className="btn px-2 py-1 text-[10px]"
            onClick={() => {
              const name = window.prompt("New directory path:");
              if (name) void handle({ op: "mkdir", path: name }, "CREATE DIR");
            }}
          >
            +DIR
          </button>
        </div>

        {error ? (
          <div className="mono-xs p-2" style={{ color: "rgb(var(--mr-danger))" }}>
            {error}
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-auto">
          <div className="dim mono-xs flex items-center gap-2 px-2 py-1">
            <span>PATH /{path === "." ? "" : path}</span>
            {parent !== null && !results ? (
              <button type="button" className="btn px-1 text-[9px]" onClick={() => void load(parent)}>
                ↑ UP
              </button>
            ) : null}
          </div>
          {list.map((e) => (
            <button
              key={e.path}
              type="button"
              onClick={() => {
                setSelected(e);
                if (e.type === "dir") void load(e.path);
                else onOpenFile?.(e.path);
              }}
              className={`flex w-full items-center gap-2 px-2 py-1 text-left text-[11px] hover:bg-[rgba(var(--mr-accent),0.08)] ${
                selected?.path === e.path ? "bg-[rgba(var(--mr-accent),0.1)]" : ""
              }`}
            >
              <span className="accent w-3 shrink-0">{e.type === "dir" ? "▸" : "·"}</span>
              <span className="min-w-0 flex-1 truncate">{results ? e.path : e.name}</span>
              <span className="dim mono-xs w-14 shrink-0 text-right">{e.type === "dir" ? "DIR" : fmtSize(e.size)}</span>
              <span className="dim mono-xs hide-md w-20 shrink-0 text-right">
                {new Date(e.modified).toLocaleDateString()}
              </span>
            </button>
          ))}
          {list.length === 0 ? <div className="dim mono-xs p-2">empty</div> : null}

          {!results ? (
            <div className="mt-2 border-t border-[color:var(--mr-border)] p-2">
              <div className="hud-label mb-1">RECENTLY MODIFIED</div>
              {recent.slice(0, 6).map((r) => (
                <button
                  key={r.path}
                  type="button"
                  className="mono-xs flex w-full justify-between gap-2 py-[2px] text-left hover:text-[rgb(var(--mr-accent))]"
                  onClick={() => onOpenFile?.(r.path)}
                >
                  <span className="truncate">{r.path}</span>
                  <span className="dim shrink-0">{new Date(r.modified).toLocaleTimeString()}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {selected ? (
          <div className="shrink-0 border-t border-[color:var(--mr-border)] p-2">
            <div className="mono-xs truncate">{selected.path}</div>
            <div className="dim mono-xs">
              {selected.type.toUpperCase()} · {fmtSize(selected.size)} · {selected.ext || "no ext"} ·{" "}
              {new Date(selected.modified).toLocaleString()}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {selected.type === "file" ? (
                <button type="button" className="btn px-2 py-1 text-[10px]" onClick={() => onOpenFile?.(selected.path)}>
                  OPEN
                </button>
              ) : null}
              <button
                type="button"
                className="btn px-2 py-1 text-[10px]"
                onClick={() => {
                  const to = window.prompt("Rename / move to:", selected.path);
                  if (to && to !== selected.path) void handle({ op: "rename", path: selected.path, to }, "RENAME");
                }}
              >
                RENAME
              </button>
              <button
                type="button"
                className="btn px-2 py-1 text-[10px]"
                onClick={() => {
                  const to = window.prompt("Copy to:", `${selected.path}.copy`);
                  if (to) void handle({ op: "copy", path: selected.path, to }, "COPY");
                }}
              >
                COPY
              </button>
              <button
                type="button"
                className="btn btn-danger px-2 py-1 text-[10px]"
                onClick={() => void handle({ op: "delete", path: selected.path }, "DELETE")}
              >
                DELETE
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}
