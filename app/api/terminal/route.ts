import { NextResponse } from "next/server";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { classifyTerminalCommand } from "@/lib/security";
import { getSettings } from "@/lib/server/settings";
import { ensureWorkspace, resolveSafe, toRelative } from "@/lib/server/workspace";
import { logCommand, logEvent } from "@/lib/server/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const registry = globalThis as typeof globalThis & {
  __mr00100Procs?: Map<string, ChildProcessWithoutNullStreams>;
};
registry.__mr00100Procs ??= new Map();
const procs = registry.__mr00100Procs;

type Body = { command: string; cwd?: string; confirmed?: boolean; kind?: string };

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json(
      { ok: false, error: "BAD REQUEST", reason: "Invalid JSON body.", action: "Retry." },
      { status: 400 },
    );
  }

  const settings = await getSettings();
  const command = (body.command ?? "").trim();
  const verdict = classifyTerminalCommand(command, settings.terminalAccess);

  if (verdict.level === "BLOCK") {
    await logCommand({ command, type: "SECURITY", status: "BLOCKED", detail: verdict.reason, risk: "BLOCK" });
    await logEvent({ type: "SECURITY_WARNING", level: "error", message: `Blocked: ${verdict.reason}`, meta: { command } });
    return NextResponse.json(
      { ok: false, blocked: true, error: "COMMAND BLOCKED", reason: verdict.reason, action: "This pattern is permanently restricted by the MR00100 security layer." },
      { status: 403 },
    );
  }
  if (verdict.level === "CONFIRM" && !body.confirmed) {
    await logCommand({ command, type: "TERMINAL", status: "CONFIRM", detail: verdict.intentDescription, risk: "CONFIRM" });
    return NextResponse.json({ ok: false, requiresConfirmation: true, verdict });
  }

  await ensureWorkspace();
  let cwd: string;
  try {
    cwd = resolveSafe(body.cwd ?? ".");
  } catch {
    return NextResponse.json(
      { ok: false, error: "INVALID WORKING DIRECTORY", reason: `"${body.cwd}" escapes the workspace sandbox.`, action: "Use a path inside the workspace." },
      { status: 400 },
    );
  }

  const id = randomUUID();
  const startedAt = Date.now();
  const encoder = new TextEncoder();
  const isBuild = /\b(build|compile)\b/.test(command) || body.kind === "build";

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (payload: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          /* stream already closed */
        }
      };

      let child: ChildProcessWithoutNullStreams;
      try {
        const shell = process.platform === "win32" ? "cmd.exe" : "/bin/bash";
        const args = process.platform === "win32" ? ["/c", command] : ["-lc", command];
        child = spawn(shell, args, {
          cwd,
          env: { ...process.env, FORCE_COLOR: "0", CI: "1" },
        }) as ChildProcessWithoutNullStreams;
      } catch (error) {
        send({
          type: "exit",
          code: -1,
          error: "SPAWN FAILED",
          reason: error instanceof Error ? error.message : "unknown",
          action: "Verify the shell is available on this host.",
          durationMs: Date.now() - startedAt,
        });
        controller.close();
        return;
      }

      procs.set(id, child);
      send({ type: "start", id, cwd: toRelative(cwd) || ".", command, risk: verdict.level });
      if (isBuild) void logEvent({ type: "BUILD_STARTED", level: "info", message: command });

      let output = "";
      const cap = (chunk: string) => {
        output += chunk;
        if (output.length > 200_000) output = output.slice(-200_000);
      };

      child.stdout.on("data", (d: Buffer) => {
        const text = d.toString();
        cap(text);
        send({ type: "stdout", data: text });
      });
      child.stderr.on("data", (d: Buffer) => {
        const text = d.toString();
        cap(text);
        send({ type: "stderr", data: text });
      });

      const timeout = setTimeout(() => {
        send({ type: "stderr", data: "\n[MR00100] timeout reached (120s) — terminating process\n" });
        child.kill("SIGKILL");
      }, 120_000);

      child.on("error", (error) => {
        send({
          type: "stderr",
          data: `\n[MR00100] ${error.message}\n`,
        });
      });

      child.on("close", (code) => {
        clearTimeout(timeout);
        procs.delete(id);
        const durationMs = Date.now() - startedAt;
        send({ type: "exit", code: code ?? -1, durationMs });
        void logCommand({
          command,
          type: isBuild ? "DEVELOPER" : "TERMINAL",
          status: code === 0 ? "SUCCESS" : "FAILED",
          detail: output.slice(-1500),
          risk: verdict.level,
          durationMs,
        });
        if (isBuild) {
          void logEvent({
            type: code === 0 ? "BUILD_SUCCESS" : "BUILD_FAILED",
            level: code === 0 ? "success" : "error",
            message: code === 0 ? `Build succeeded: ${command}` : `Build failed (exit ${code}): ${command}`,
            meta: { tail: output.slice(-800) },
          });
        }
        controller.close();
      });
    },
    cancel() {
      const child = procs.get(id);
      child?.kill("SIGTERM");
      procs.delete(id);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Run-Id": id,
    },
  });
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id") ?? "";
  const child = procs.get(id);
  if (!child) {
    return NextResponse.json(
      { ok: false, error: "NO SUCH PROCESS", reason: `Run id ${id} is not active.`, action: "The process already exited." },
      { status: 404 },
    );
  }
  child.kill("SIGTERM");
  setTimeout(() => child.kill("SIGKILL"), 2000);
  procs.delete(id);
  await logEvent({ type: "TERMINAL_FINISHED", level: "warn", message: `Process ${id} terminated by operator` });
  return NextResponse.json({ ok: true, id, killed: true });
}

export async function GET() {
  return NextResponse.json({ ok: true, running: Array.from(procs.keys()) });
}
