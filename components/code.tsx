"use client";

import { useMemo, useState, type ReactNode } from "react";

type Tok = { t: string; v: string };

const MASTER =
  /(\/\*[\s\S]*?\*\/|\/\/[^\n]*|#[^\n]*|"""[\s\S]*?""")|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|\b(0x[\da-fA-F]+|\d+\.?\d*)\b|\b(const|let|var|function|return|if|else|elif|for|while|do|class|extends|implements|import|from|export|default|new|await|async|try|catch|finally|throw|typeof|instanceof|interface|type|enum|public|private|protected|readonly|static|def|lambda|None|True|False|self|null|undefined|true|false|this|super|switch|case|break|continue|in|of|as|not|and|or|is|pass|with|yield|void|never|any|string|number|boolean|print|console)\b|([A-Za-z_$][\w$]*)(?=\s*\()|([{}()[\];,.:<>+\-*/%=!&|?])/g;

export function tokenize(code: string): Tok[] {
  const out: Tok[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  MASTER.lastIndex = 0;
  while ((m = MASTER.exec(code))) {
    if (m.index > last) out.push({ t: "txt", v: code.slice(last, m.index) });
    if (m[1]) out.push({ t: "com", v: m[1] });
    else if (m[2]) out.push({ t: "str", v: m[2] });
    else if (m[3]) out.push({ t: "num", v: m[3] });
    else if (m[4]) out.push({ t: "kw", v: m[4] });
    else if (m[5]) out.push({ t: "fn", v: m[5] });
    else if (m[6]) out.push({ t: "pun", v: m[6] });
    last = m.index + m[0].length;
  }
  if (last < code.length) out.push({ t: "txt", v: code.slice(last) });
  return out;
}

const COLORS: Record<string, string> = {
  com: "rgba(120,160,150,0.65)",
  str: "rgb(255,200,120)",
  num: "rgb(150,220,255)",
  kw: "rgb(90,230,255)",
  fn: "rgb(180,255,200)",
  pun: "rgba(180,220,210,0.7)",
  txt: "inherit",
};

export function Highlighted({ code }: { code: string }): ReactNode {
  const toks = useMemo(() => tokenize(code), [code]);
  return (
    <>
      {toks.map((t, i) => (
        <span key={i} style={{ color: COLORS[t.t] }}>
          {t.v}
        </span>
      ))}
    </>
  );
}

export function CodeBlock({
  code,
  lang,
  filePath,
  onSave,
}: {
  code: string;
  lang?: string;
  filePath?: string;
  onSave?: (path: string, content: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="my-2 border border-[color:var(--mr-border)] bg-black/55">
      <div className="flex items-center justify-between border-b border-[color:var(--mr-border)] px-2 py-1">
        <span className="hud-label truncate">
          {filePath ? filePath : lang || "code"}
        </span>
        <div className="flex gap-1">
          <button
            type="button"
            className="btn px-1.5 py-0.5 text-[9px]"
            onClick={() => {
              void navigator.clipboard.writeText(code).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1400);
              });
            }}
          >
            {copied ? "COPIED" : "COPY"}
          </button>
          {onSave ? (
            <button
              type="button"
              className="btn px-1.5 py-0.5 text-[9px]"
              onClick={() => {
                const target = filePath || window.prompt("Save to workspace path:") || "";
                if (target) onSave(target, code);
              }}
            >
              SAVE
            </button>
          ) : null}
        </div>
      </div>
      <pre className="code-scroll max-h-[340px] overflow-auto p-2 text-[11px] leading-[1.5] whitespace-pre">
        <Highlighted code={code} />
      </pre>
    </div>
  );
}

type Segment =
  | { kind: "text"; value: string }
  | { kind: "code"; value: string; lang?: string; path?: string };

export function parseSegments(markdown: string): Segment[] {
  const segments: Segment[] = [];
  const re = /```([^\n]*)\n([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown))) {
    if (m.index > last) segments.push({ kind: "text", value: markdown.slice(last, m.index) });
    const info = m[1].trim().split(/\s+/);
    segments.push({ kind: "code", value: m[2], lang: info[0] || undefined, path: info[1] });
    last = m.index + m[0].length;
  }
  if (last < markdown.length) segments.push({ kind: "text", value: markdown.slice(last) });
  // unterminated fence while streaming
  const openFence = markdown.lastIndexOf("```");
  if (openFence > -1 && segments.length && segments[segments.length - 1].kind === "text") {
    const tail = segments[segments.length - 1].value;
    const idx = tail.lastIndexOf("```");
    if (idx > -1) {
      const header = tail.slice(idx + 3).split("\n")[0].trim().split(/\s+/);
      const body = tail.slice(idx + 3).split("\n").slice(1).join("\n");
      segments[segments.length - 1] = { kind: "text", value: tail.slice(0, idx) };
      segments.push({ kind: "code", value: body, lang: header[0] || undefined, path: header[1] });
    }
  }
  return segments;
}

export function RichText({ value }: { value: string }) {
  const lines = value.split("\n");
  return (
    <div className="space-y-1 text-[12px] leading-relaxed whitespace-pre-wrap">
      {lines.map((line, i) => {
        if (/^#{1,4}\s/.test(line))
          return (
            <div key={i} className="accent glow pt-1 text-[12px] tracking-wider">
              {line.replace(/^#{1,4}\s/, "")}
            </div>
          );
        if (/^\s*[-*]\s/.test(line))
          return (
            <div key={i} className="pl-3">
              <span className="accent">›</span> {line.replace(/^\s*[-*]\s/, "")}
            </div>
          );
        return <div key={i}>{line}</div>;
      })}
    </div>
  );
}
