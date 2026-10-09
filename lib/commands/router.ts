import type { AssistantSettings } from "../config";
import { detectIntent, type DetectedIntent } from "../intent";
import { parseDesktopPlan } from "./intents";
import { executePlan } from "./executor";
import type { CommandTrace, ParsedPlan } from "./types";

export type DispatchRequest = {
  input: string;
  confirmed?: boolean;
  source?: "voice" | "chat" | "dock";
  preview?: boolean;
  settings: AssistantSettings;
};

export type DispatchResult = {
  ok: boolean;
  route: "LOCAL" | "AI" | "DEVELOPER";
  fallback?: boolean;
  intent?: string;
  language?: string;
  normalized?: string;
  understanding?: string;
  trace: CommandTrace;
  requiresAi?: boolean;
  requiresConfirmation?: boolean;
  blocked?: boolean;
  task?: "general" | "developer" | "reasoning";
  prompt?: string;
  model?: string;
  title?: string;
  speak?: string;
  detail?: string;
  reason?: string;
  action?: string;
  error?: string;
  verdict?: {
    intentDescription: string;
    reason: string;
    affected?: string;
    level?: string;
  };
  data?: Record<string, unknown>;
  plan?: ParsedPlan;
  legacy?: DetectedIntent;
};

export function previewCommand(input: string): DispatchResult {
  const plan = parseDesktopPlan(input);
  if (plan) {
    return {
      ok: true,
      route: "LOCAL",
      language: plan.language,
      normalized: plan.normalized,
      understanding: plan.understanding,
      intent: plan.actions.map((a) => a.type).join(","),
      plan,
      trace: {
        command: plan.original,
        language: plan.language,
        understanding: plan.understanding,
        stage: "UNDERSTANDING",
        detail: plan.actions.map((a) => a.type).join(" + "),
      },
    };
  }
  const legacy = detectIntent(input);
  return {
    ok: true,
    fallback: true,
    route: legacy.route,
    intent: legacy.intent,
    legacy,
    trace: {
      command: input,
      language: "unknown",
      understanding: legacy.intent,
      stage: "UNDERSTANDING",
      detail: legacy.route,
    },
  };
}

export async function dispatchDesktop(req: DispatchRequest): Promise<DispatchResult | null> {
  const plan = parseDesktopPlan(req.input);
  if (!plan) return null;
  if (req.preview) return previewCommand(req.input);

  const executed = await executePlan(plan, req.settings, Boolean(req.confirmed));
  const trace: CommandTrace = {
    command: plan.original,
    language: plan.language,
    understanding: plan.understanding,
    stage: executed.blocked ? "FAILED" : executed.requiresConfirmation ? "UNDERSTANDING" : executed.ok ? "COMPLETED" : "FAILED",
    detail: executed.speak,
  };

  if (executed.blocked) {
    return {
      ok: false,
      route: "LOCAL",
      blocked: true,
      language: plan.language,
      understanding: plan.understanding,
      intent: plan.actions.map((a) => a.type).join(","),
      error: "ACTION BLOCKED",
      reason: executed.verdict?.reason,
      action: "Restricted by the MR00100 security layer.",
      speak: executed.speak,
      title: executed.title,
      verdict: executed.verdict,
      trace,
    };
  }
  if (executed.requiresConfirmation) {
    return {
      ok: false,
      route: "LOCAL",
      requiresConfirmation: true,
      language: plan.language,
      understanding: plan.understanding,
      intent: plan.actions.map((a) => a.type).join(","),
      speak: executed.speak,
      title: executed.title,
      verdict: executed.verdict,
      trace: { ...trace, stage: "UNDERSTANDING", detail: executed.verdict?.intentDescription ?? "" },
    };
  }

  return {
    ok: executed.ok,
    route: "LOCAL",
    language: plan.language,
    normalized: plan.normalized,
    understanding: plan.understanding,
    intent: plan.actions.map((a) => a.type).join(","),
    title: executed.title,
    speak: executed.speak,
    detail: executed.detail,
    reason: executed.ok ? undefined : executed.results.find((r) => !r.ok)?.reason,
    action: executed.ok ? undefined : executed.results.find((r) => !r.ok)?.action,
    data: executed.data,
    trace,
  };
}
