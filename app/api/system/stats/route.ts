import { NextResponse } from "next/server";
import { collectTelemetry } from "@/lib/server/telemetry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const withProcesses = url.searchParams.get("processes") !== "0";
  try {
    const telemetry = await collectTelemetry(withProcesses);
    return NextResponse.json({ ok: true, telemetry });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "TELEMETRY FAILURE",
        reason: error instanceof Error ? error.message : "unknown",
        action: "System monitoring is degraded. Reload the interface; local commands still work.",
      },
      { status: 500 },
    );
  }
}
