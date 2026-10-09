import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { DEFAULT_SETTINGS, type AssistantSettings } from "../config";

const g = globalThis as typeof globalThis & {
  __mr00100Settings?: { value: AssistantSettings; t: number };
};

export class ConfigError extends Error {
  constructor(
    message: string,
    readonly reason: string,
    readonly action: string,
  ) {
    super(message);
  }
}

export async function getSettings(force = false): Promise<AssistantSettings> {
  const cached = g.__mr00100Settings;
  if (!force && cached && Date.now() - cached.t < 3000) return cached.value;
  try {
    const rows = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.id, 1))
      .limit(1);
    const stored = (rows[0]?.data ?? {}) as Partial<AssistantSettings>;
    const value = { ...DEFAULT_SETTINGS, ...stored };
    g.__mr00100Settings = { value, t: Date.now() };
    return value;
  } catch (error) {
    throw new ConfigError(
      "SETTINGS STORE UNAVAILABLE",
      error instanceof Error ? error.message : "Unknown database failure",
      "Verify DATABASE_URL in .env and that PostgreSQL is reachable, then reload.",
    );
  }
}

export async function saveSettings(
  patch: Partial<AssistantSettings>,
): Promise<AssistantSettings> {
  const current = await getSettings(true);
  const next = { ...current, ...patch };
  await db
    .insert(appSettings)
    .values({ id: 1, data: next as unknown as Record<string, unknown> })
    .onConflictDoUpdate({
      target: appSettings.id,
      set: { data: next as unknown as Record<string, unknown>, updatedAt: new Date() },
    });
  g.__mr00100Settings = { value: next, t: Date.now() };
  return next;
}

export function resolveApiKey(settings: AssistantSettings): string {
  return (process.env.OPENROUTER_API_KEY ?? settings.apiKeyOverride ?? "").trim();
}
