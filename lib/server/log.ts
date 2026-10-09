import { desc, sql } from "drizzle-orm";
import { db } from "@/db";
import { commandHistory, systemEvents } from "@/db/schema";

export type HistoryType =
  | "SYSTEM"
  | "AI"
  | "DEVELOPER"
  | "FILE"
  | "TERMINAL"
  | "VOICE"
  | "SECURITY"
  | "NETWORK";

export type HistoryStatus = "SUCCESS" | "FAILED" | "BLOCKED" | "PENDING" | "CONFIRM";

export async function logCommand(entry: {
  command: string;
  type: HistoryType;
  status: HistoryStatus;
  detail?: string;
  risk?: string;
  durationMs?: number;
}) {
  try {
    const [row] = await db
      .insert(commandHistory)
      .values({
        command: entry.command.slice(0, 500),
        type: entry.type,
        status: entry.status,
        detail: entry.detail?.slice(0, 2000),
        risk: entry.risk,
        durationMs: entry.durationMs,
      })
      .returning();
    return row;
  } catch {
    return null;
  }
}

export async function logEvent(entry: {
  type: string;
  level?: "info" | "warn" | "error" | "success";
  message: string;
  meta?: Record<string, unknown>;
}) {
  try {
    const [row] = await db
      .insert(systemEvents)
      .values({
        type: entry.type,
        level: entry.level ?? "info",
        message: entry.message.slice(0, 500),
        meta: entry.meta,
      })
      .returning();
    return row;
  } catch {
    return null;
  }
}

export async function recentHistory(limit = 40) {
  return db.select().from(commandHistory).orderBy(desc(commandHistory.id)).limit(limit);
}

export async function recentEvents(limit = 40) {
  return db.select().from(systemEvents).orderBy(desc(systemEvents.id)).limit(limit);
}

export async function historyStats() {
  const rows = await db
    .select({
      type: commandHistory.type,
      status: commandHistory.status,
      count: sql<number>`count(*)::int`,
    })
    .from(commandHistory)
    .groupBy(commandHistory.type, commandHistory.status);
  return rows;
}
