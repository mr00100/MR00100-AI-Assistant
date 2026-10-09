import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { chatMessages, memoryEntries } from "@/db/schema";
import { getSettings } from "@/lib/server/settings";
import {
  AiError,
  buildSystemPrompt,
  callOpenRouter,
  pickModel,
  type ChatMessage,
  type AiTask,
} from "@/lib/server/openrouter";
import { collectTelemetry } from "@/lib/server/telemetry";
import { projectTreeSummary, readFileSafe } from "@/lib/server/workspace";
import { logCommand, logEvent } from "@/lib/server/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

type Body = {
  prompt: string;
  task?: AiTask;
  sessionId?: string;
  includeTelemetry?: boolean;
  includeProject?: boolean;
  openFile?: string | null;
  historyLimit?: number;
};

export async function POST(request: Request) {
  const started = Date.now();
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json(
      { ok: false, error: "BAD REQUEST", reason: "Invalid JSON body.", action: "Retry." },
      { status: 400 },
    );
  }

  const prompt = (body.prompt ?? "").trim();
  if (!prompt) {
    return NextResponse.json(
      { ok: false, error: "EMPTY PROMPT", reason: "No prompt supplied.", action: "Type a request." },
      { status: 400 },
    );
  }

  const settings = await getSettings();
  const task: AiTask = body.task ?? "general";
  const sessionId = body.sessionId ?? "default";

  try {
    const [telemetry, tree, memory, history] = await Promise.all([
      body.includeTelemetry ? collectTelemetry(false) : Promise.resolve(null),
      body.includeProject || task === "developer" ? projectTreeSummary(90) : Promise.resolve(""),
      settings.memoryEnabled
        ? db.select().from(memoryEntries).orderBy(desc(memoryEntries.pinned)).limit(20)
        : Promise.resolve([]),
      db
        .select()
        .from(chatMessages)
        .where(eq(chatMessages.sessionId, sessionId))
        .orderBy(desc(chatMessages.id))
        .limit(Math.min(body.historyLimit ?? 8, 20)),
    ]);

    let openFile: { path: string; content: string } | null = null;
    if (body.openFile) {
      const f = await readFileSafe(body.openFile).catch(() => null);
      if (f) openFile = { path: f.path, content: f.content };
    }

    const telemetryText = telemetry
      ? `CPU ${telemetry.cpu.usage}% (${telemetry.cpu.cores} cores) · RAM ${telemetry.ram.usedPct}% (${telemetry.ram.usedGb}/${telemetry.ram.totalGb} GB) · DISK ${
          telemetry.disk ? `${telemetry.disk.usedPct}%` : "n/a"
        } · NET ${telemetry.network.online ? "online" : "offline"} rx ${telemetry.network.rxMbps} MB/s · HOST ${telemetry.host.platform} ${telemetry.host.hostname}`
      : undefined;

    const memoryText = memory.length
      ? memory.map((m) => `- [${m.category}] ${m.key}: ${m.value}`).join("\n")
      : undefined;

    const messages: ChatMessage[] = [
      {
        role: "system",
        content: buildSystemPrompt({
          task,
          telemetry: telemetryText,
          project: tree || undefined,
          memory: memoryText,
          openFile,
        }),
      },
      ...history
        .reverse()
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      { role: "user", content: prompt },
    ];

    await db.insert(chatMessages).values({ sessionId, role: "user", content: prompt, mode: task === "developer" ? "DEVELOPER" : "AI" });

    const { res, model } = await callOpenRouter({ settings, messages, task, stream: true });
    await logEvent({ type: "AI_STARTED", level: "info", message: `${model} · ${task}` });

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    let full = "";

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (payload: Record<string, unknown>) =>
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        send({ type: "start", model, task });

        const reader = res.body?.getReader();
        if (!reader) {
          send({ type: "error", error: "NO STREAM", reason: "Provider returned an empty body.", action: "Retry or disable streaming." });
          controller.close();
          return;
        }
        let buffer = "";
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith("data:")) continue;
              const payload = trimmed.slice(5).trim();
              if (payload === "[DONE]") continue;
              try {
                const json = JSON.parse(payload) as {
                  choices?: Array<{ delta?: { content?: string } }>;
                };
                const delta = json.choices?.[0]?.delta?.content;
                if (delta) {
                  full += delta;
                  send({ type: "delta", content: delta });
                }
              } catch {
                /* keep-alive comment or partial frame */
              }
            }
          }
        } catch (error) {
          send({
            type: "error",
            error: "STREAM INTERRUPTED",
            reason: error instanceof Error ? error.message : "unknown",
            action: "Retry the request; partial output is preserved.",
          });
        }

        const durationMs = Date.now() - started;
        if (full.trim()) {
          await db
            .insert(chatMessages)
            .values({ sessionId, role: "assistant", content: full, model, mode: task === "developer" ? "DEVELOPER" : "AI" })
            .catch(() => null);
        }
        await logCommand({
          command: prompt.slice(0, 200),
          type: task === "developer" ? "DEVELOPER" : "AI",
          status: full.trim() ? "SUCCESS" : "FAILED",
          detail: `${model} · ${full.length} chars`,
          risk: "CONFIRM",
          durationMs,
        });
        await logEvent({ type: "AI_FINISHED", level: "success", message: `${model} completed in ${(durationMs / 1000).toFixed(1)}s` });
        send({ type: "done", model, durationMs, chars: full.length });
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    const model = pickModel(settings, task);
    if (error instanceof AiError) {
      await logCommand({ command: prompt.slice(0, 200), type: "AI", status: "FAILED", detail: error.reason, durationMs: Date.now() - started });
      return NextResponse.json(
        { ok: false, error: error.message, reason: error.reason, action: error.action, model },
        { status: error.status },
      );
    }
    return NextResponse.json(
      {
        ok: false,
        error: "AI ENGINE FAILURE",
        reason: error instanceof Error ? error.message : "unknown",
        action: "Check network connectivity and provider configuration in Settings.",
        model,
      },
      { status: 500 },
    );
  }
}
