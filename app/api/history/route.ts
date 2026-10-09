import { NextResponse } from "next/server";
import { db } from "@/db";
import { commandHistory, systemEvents } from "@/db/schema";
import { historyStats, logCommand, logEvent, recentEvents, recentHistory } from "@/lib/server/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 40), 200);
  try {
    const [history, events, stats] = await Promise.all([
      recentHistory(limit),
      recentEvents(30),
      historyStats(),
    ]);
    return NextResponse.json({ ok: true, history, events, stats });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "HISTORY UNAVAILABLE",
        reason: error instanceof Error ? error.message : "unknown",
        action: "Check DATABASE_URL in .env and that PostgreSQL is running, then reload.",
      },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      kind?: "command" | "event";
      command?: string;
      type?: string;
      status?: string;
      detail?: string;
      level?: "info" | "warn" | "error" | "success";
      message?: string;
      meta?: Record<string, unknown>;
    };
    if (body.kind === "event") {
      const row = await logEvent({
        type: body.type ?? "UI_EVENT",
        level: body.level ?? "info",
        message: body.message ?? "",
        meta: body.meta,
      });
      return NextResponse.json({ ok: true, row });
    }
    const row = await logCommand({
      command: body.command ?? body.message ?? "",
      type: (body.type as "SYSTEM") ?? "SYSTEM",
      status: (body.status as "SUCCESS") ?? "SUCCESS",
      detail: body.detail,
    });
    return NextResponse.json({ ok: true, row });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: "LOG WRITE FAILED", reason: String(error), action: "Retry; the UI keeps a local copy." },
      { status: 500 },
    );
  }
}

export async function DELETE() {
  try {
    await db.delete(commandHistory);
    await db.delete(systemEvents);
    return NextResponse.json({ ok: true, cleared: true });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: "CLEAR FAILED", reason: String(error), action: "Retry once the database is reachable." },
      { status: 500 },
    );
  }
}
