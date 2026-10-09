import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { memoryEntries } from "@/db/schema";
import { logEvent } from "@/lib/server/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const rows = await db
      .select()
      .from(memoryEntries)
      .orderBy(desc(memoryEntries.pinned), desc(memoryEntries.updatedAt))
      .limit(200);
    return NextResponse.json({ ok: true, entries: rows });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "MEMORY UNAVAILABLE",
        reason: error instanceof Error ? error.message : "unknown",
        action: "Verify DATABASE_URL and that the memory_entries table exists (npx drizzle-kit push).",
      },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      category?: string;
      key: string;
      value: string;
      pinned?: boolean;
    };
    if (!body.key?.trim() || !body.value?.trim()) {
      return NextResponse.json(
        { ok: false, error: "INVALID MEMORY", reason: "Key and value are both required.", action: "Fill both fields." },
        { status: 400 },
      );
    }
    const [row] = await db
      .insert(memoryEntries)
      .values({
        category: body.category?.trim() || "general",
        key: body.key.trim(),
        value: body.value.trim(),
        pinned: Boolean(body.pinned),
      })
      .returning();
    await logEvent({ type: "MEMORY_WRITE", level: "info", message: `Stored memory: ${row.key}` });
    return NextResponse.json({ ok: true, entry: row });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: "MEMORY WRITE FAILED", reason: String(error), action: "Retry." },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as {
      id: number;
      key?: string;
      value?: string;
      category?: string;
      pinned?: boolean;
    };
    const [row] = await db
      .update(memoryEntries)
      .set({
        ...(body.key !== undefined ? { key: body.key } : {}),
        ...(body.value !== undefined ? { value: body.value } : {}),
        ...(body.category !== undefined ? { category: body.category } : {}),
        ...(body.pinned !== undefined ? { pinned: body.pinned } : {}),
        updatedAt: new Date(),
      })
      .where(eq(memoryEntries.id, body.id))
      .returning();
    return NextResponse.json({ ok: true, entry: row });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: "MEMORY UPDATE FAILED", reason: String(error), action: "Retry." },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  try {
    if (id === "all") {
      await db.delete(memoryEntries);
      await logEvent({ type: "MEMORY_CLEARED", level: "warn", message: "All local memory erased by operator" });
      return NextResponse.json({ ok: true, cleared: true });
    }
    if (!id) {
      return NextResponse.json(
        { ok: false, error: "MISSING ID", reason: "No memory id supplied.", action: "Select an entry first." },
        { status: 400 },
      );
    }
    await db.delete(memoryEntries).where(eq(memoryEntries.id, Number(id)));
    return NextResponse.json({ ok: true, deleted: Number(id) });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: "MEMORY DELETE FAILED", reason: String(error), action: "Retry." },
      { status: 500 },
    );
  }
}
