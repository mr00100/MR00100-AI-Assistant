import { NextResponse } from "next/server";
import { getSettings, resolveApiKey } from "@/lib/server/settings";
import { listModels } from "@/lib/server/openrouter";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const settings = await getSettings();
    const { models, live } = await listModels(settings);
    return NextResponse.json({
      ok: true,
      live,
      keyConfigured: Boolean(resolveApiKey(settings)),
      provider: settings.aiProvider,
      models: models.slice(0, 400),
      selected: {
        general: settings.generalModel,
        developer: settings.developerModel,
        reasoning: settings.reasoningModel,
        fallback: settings.fallbackModel,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "MODEL CATALOG UNAVAILABLE",
        reason: error instanceof Error ? error.message : "unknown",
        action: "Configure OPENROUTER_API_KEY, or type a model id manually in Settings.",
      },
      { status: 500 },
    );
  }
}
