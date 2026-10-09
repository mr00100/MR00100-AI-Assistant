import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { chatMessages } from "@/db/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("session") ?? "default";
  try {
    const rows = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, sessionId))
      .orderBy(asc(chatMessages.id))
      .limit(200);
    return NextResponse.json({ ok: true, messages: rows });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "TRANSCRIPT UNAVAILABLE",
        reason: error instanceof Error ? error.message : "unknown",
        action: "Verify DATABASE_URL and run `npx drizzle-kit push`.",
      },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      sessionId?: string;
      role: "user" | "assistant" | "system";
      content: string;
      mode?: string;
      model?: string;
    };
    const [row] = await db
      .insert(chatMessages)
      .values({
        sessionId: body.sessionId ?? "default",
        role: body.role,
        content: body.content,
        mode: body.mode,
        model: body.model,
      })
      .returning();
    return NextResponse.json({ ok: true, message: row });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: "TRANSCRIPT WRITE FAILED", reason: String(error), action: "Retry." },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("session") ?? "default";
  try {
    await db.delete(chatMessages).where(eq(chatMessages.sessionId, sessionId));
    return NextResponse.json({ ok: true, cleared: sessionId });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: "CLEAR FAILED", reason: String(error), action: "Retry." },
      { status: 500 },
    );
  }
}
