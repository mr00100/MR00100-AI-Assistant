import { NextResponse } from "next/server";
import { ConfigError, getSettings, resolveApiKey, saveSettings } from "@/lib/server/settings";
import { maskKey, type AssistantSettings } from "@/lib/config";
import { workspaceRoot } from "@/lib/server/workspace";
import { logEvent } from "@/lib/server/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function publicView(settings: AssistantSettings) {
  const key = resolveApiKey(settings);
  return {
    ...settings,
    apiKeyOverride: settings.apiKeyOverride ? maskKey(settings.apiKeyOverride) : "",
    workspaceDir: workspaceRoot(),
    _meta: {
      keyConfigured: Boolean(key),
      keySource: process.env.OPENROUTER_API_KEY ? "env" : settings.apiKeyOverride ? "settings" : "none",
      keyMasked: maskKey(key),
    },
  };
}

export async function GET() {
  try {
    const settings = await getSettings(true);
    return NextResponse.json({ ok: true, settings: publicView(settings) });
  } catch (error) {
    if (error instanceof ConfigError) {
      return NextResponse.json(
        { ok: false, error: error.message, reason: error.reason, action: error.action },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { ok: false, error: "SETTINGS READ FAILED", reason: String(error), action: "Reload the interface." },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const patch = (await request.json()) as Partial<AssistantSettings>;
    if ("apiKeyOverride" in patch && patch.apiKeyOverride?.includes("••")) delete patch.apiKeyOverride;
    delete (patch as Record<string, unknown>)._meta;
    const next = await saveSettings(patch);
    await logEvent({ type: "SETTINGS_CHANGED", level: "info", message: `Updated: ${Object.keys(patch).join(", ")}` });
    return NextResponse.json({ ok: true, settings: publicView(next) });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "SETTINGS WRITE FAILED",
        reason: error instanceof Error ? error.message : "unknown",
        action: "Verify the database connection (DATABASE_URL) and retry.",
      },
      { status: 500 },
    );
  }
}
