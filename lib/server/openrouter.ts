import type { AssistantSettings } from "../config";
import { SYSTEM_PERSONA } from "../config";
import { resolveApiKey } from "./settings";

export type ChatRole = "system" | "user" | "assistant";
export type ChatMessage = { role: ChatRole; content: string };

export type AiTask = "general" | "developer" | "reasoning";

export class AiError extends Error {
  constructor(
    message: string,
    readonly reason: string,
    readonly action: string,
    readonly status = 500,
  ) {
    super(message);
  }
}

export function pickModel(settings: AssistantSettings, task: AiTask): string {
  if (task === "developer") return settings.developerModel || settings.generalModel;
  if (task === "reasoning") return settings.reasoningModel || settings.generalModel;
  return settings.generalModel;
}

export function buildSystemPrompt(context: {
  task: AiTask;
  telemetry?: string;
  project?: string;
  memory?: string;
  openFile?: { path: string; content: string } | null;
}) {
  const parts = [SYSTEM_PERSONA];
  if (context.task === "developer") {
    parts.push(
      `DEVELOPER MODE ACTIVE. You are operating inside a sandboxed workspace.
Provide precise, runnable code. Prefer minimal diffs. State the exact terminal
commands MR00100 should run, and mention which are destructive.`,
    );
  }
  if (context.telemetry) parts.push(`LIVE HOST TELEMETRY (authoritative):\n${context.telemetry}`);
  if (context.project) parts.push(`WORKSPACE TREE:\n${context.project}`);
  if (context.openFile)
    parts.push(
      `ACTIVE FILE: ${context.openFile.path}\n\`\`\`\n${context.openFile.content.slice(0, 12000)}\n\`\`\``,
    );
  if (context.memory) parts.push(`OPERATOR MEMORY:\n${context.memory}`);
  return parts.join("\n\n");
}

type CallOptions = {
  settings: AssistantSettings;
  messages: ChatMessage[];
  task: AiTask;
  stream?: boolean;
  signal?: AbortSignal;
};

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

function headers(key: string) {
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    "HTTP-Referer": process.env.OPENROUTER_SITE_URL ?? "https://mr00100.local",
    "X-Title": "MR00100 AI",
  };
}

async function request(model: string, opts: CallOptions, key: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.settings.requestTimeoutMs);
  if (opts.signal) opts.signal.addEventListener("abort", () => controller.abort());
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: headers(key),
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages: opts.messages,
        temperature: opts.settings.temperature,
        max_tokens: opts.settings.maxTokens,
        stream: Boolean(opts.stream),
      }),
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

export async function callOpenRouter(opts: CallOptions) {
  const key = resolveApiKey(opts.settings);
  if (!key) {
    throw new AiError(
      "AI ENGINE OFFLINE",
      "OPENROUTER_API_KEY is not configured and no key override is stored.",
      "Add OPENROUTER_API_KEY to .env or paste a key in Settings → AI Provider. Local commands keep working without it.",
      503,
    );
  }
  if (opts.settings.aiProvider !== "openrouter") {
    throw new AiError(
      "PROVIDER NOT AVAILABLE",
      `Provider "${opts.settings.aiProvider}" has no adapter compiled in.`,
      "Select the OpenRouter provider in Settings.",
      400,
    );
  }

  const primary = pickModel(opts.settings, opts.task);
  let res = await request(primary, opts, key);
  let usedModel = primary;

  if (!res.ok && opts.settings.fallbackModel && opts.settings.fallbackModel !== primary) {
    const body = await res.text().catch(() => "");
    if (res.status === 404 || res.status === 429 || res.status >= 500) {
      res = await request(opts.settings.fallbackModel, opts, key);
      usedModel = opts.settings.fallbackModel;
    } else {
      throw new AiError(
        `AI REQUEST REJECTED (${res.status})`,
        body.slice(0, 400) || res.statusText,
        res.status === 401
          ? "The API key was rejected. Verify OPENROUTER_API_KEY."
          : "Adjust the model or parameters in Settings and retry.",
        res.status,
      );
    }
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new AiError(
      `AI REQUEST FAILED (${res.status})`,
      body.slice(0, 400) || res.statusText,
      "Check the model id, your OpenRouter credit balance and network connectivity.",
      res.status,
    );
  }

  return { res, model: usedModel };
}

export async function completeOnce(opts: CallOptions): Promise<{ content: string; model: string }> {
  const { res, model } = await callOpenRouter({ ...opts, stream: false });
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content ?? "";
  if (!content) {
    throw new AiError(
      "EMPTY AI RESPONSE",
      "The provider returned no message content.",
      "Retry, lower max tokens, or switch model.",
      502,
    );
  }
  return { content, model };
}

export async function listModels(settings: AssistantSettings) {
  const key = resolveApiKey(settings);
  const fallback = [
    settings.generalModel,
    settings.developerModel,
    settings.reasoningModel,
    settings.fallbackModel,
  ].filter(Boolean);
  if (!key) return { models: Array.from(new Set(fallback)), live: false };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      headers: headers(key),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return { models: Array.from(new Set(fallback)), live: false };
    const json = (await res.json()) as { data?: Array<{ id: string }> };
    const ids = (json.data ?? []).map((m) => m.id).sort();
    return { models: ids.length ? ids : Array.from(new Set(fallback)), live: ids.length > 0 };
  } catch {
    return { models: Array.from(new Set(fallback)), live: false };
  }
}
