import { NextResponse } from "next/server";
import { detectIntent, HELP_TEXT, type DetectedIntent } from "@/lib/intent";
import { classifyAppLaunch, classifyFileOperation, type SecurityVerdict } from "@/lib/security";
import { ConfigError, getSettings, resolveApiKey } from "@/lib/server/settings";
import { logCommand, logEvent } from "@/lib/server/log";
import { WorkspaceError } from "@/lib/server/workspace";
import { dispatchDesktop, previewCommand } from "@/lib/commands";
import { researchPrompt, researchWeb } from "@/lib/commands/research";
import {
  clipboardRead,
  clipboardWrite,
  closeApp,
  fileCreate,
  fileDelete,
  launchApp,
  openFolder,
  openUrl,
  readFileTool,
  searchFiles,
  setVolume,
  systemInfo,
  workspaceOverview,
  type ToolResult,
} from "@/lib/server/tools";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Body = { input: string; confirmed?: boolean; source?: "voice" | "chat" | "dock"; preview?: boolean };

export async function POST(request: Request) {
  let command = "";
  try {
    const body = JSON.parse(await request.clone().text()) as { input?: unknown };
    if (typeof body.input === "string") command = body.input.slice(0, 500);
  } catch {
    /* The handler below returns the structured bad-request response. */
  }

  try {
    return await handleCommand(request);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown local executor failure.";
    const action = error instanceof ConfigError
      ? error.action
      : error instanceof WorkspaceError
        ? error.action
        : "Review the executor error, workspace path, and local service logs, then retry.";
    const status = error instanceof ConfigError ? 503 : error instanceof WorkspaceError ? 403 : 500;
    const code = error instanceof ConfigError
      ? "SETTINGS_UNAVAILABLE"
      : error instanceof WorkspaceError
        ? "WORKSPACE_PERMISSION_DENIED"
        : "COMMAND_EXECUTION_FAILED";

    console.error("[MR00100 command executor]", { command, code, reason });
    await logCommand({
      command: command || "<unavailable command body>",
      type: /vscode|vs code|index\.html|\.py\b/i.test(command) ? "DEVELOPER" : "SYSTEM",
      status: error instanceof WorkspaceError ? "BLOCKED" : "FAILED",
      detail: `${code}: ${reason}`,
      risk: error instanceof WorkspaceError ? "BLOCK" : "EXECUTOR",
    });

    return NextResponse.json(
      {
        ok: false,
        route: "LOCAL",
        error: code,
        code,
        message: "MR00100 could not complete the command.",
        reason,
        action,
        details: { executor: "local-command-router", timestamp: new Date().toISOString() },
      },
      { status },
    );
  }
}

async function handleCommand(request: Request) {
  const started = Date.now();
  let body: Body;
  try {
    body = (await request.json()) as Body;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Expected a JSON object.");
  } catch {
    return NextResponse.json(
      { ok: false, error: "BAD REQUEST", code: "INVALID_JSON", message: "Invalid command request body.", reason: "Expected a valid JSON object.", action: "Retry the command." },
      { status: 400 },
    );
  }

  const input = typeof body.input === "string" ? body.input.trim() : "";
  if (!input) {
    return NextResponse.json(
      { ok: false, error: "EMPTY COMMAND", reason: "No input was received.", action: "Speak or type a command." },
      { status: 400 },
    );
  }

  const settings = await getSettings();
  if (body.preview) {
    return NextResponse.json(previewCommand(input));
  }

  const desktop = await dispatchDesktop({
    input,
    confirmed: body.confirmed,
    source: body.source,
    settings,
  });
  if (desktop) {
    // Current-information requests: retrieve live sources, then summarise via the AI engine.
    if (desktop.intent === "web.research" && desktop.ok && !body.confirmed) {
      const query = desktop.data?.query ? String(desktop.data.query) : input;
      const category = desktop.data?.category ? String(desktop.data.category) : "";
      const bundle = await researchWeb(query, category);
      if (!bundle.ok) {
        await logCommand({
          command: input,
          type: "NETWORK",
          status: "FAILED",
          detail: `web.research: ${bundle.reason ?? "no sources"}`,
          risk: "SAFE",
        });
        return NextResponse.json(
          {
            ...desktop,
            ok: false,
            speak: "I couldn't reach live web sources for that question.",
            reason: bundle.reason ?? "Web research returned no sources.",
            action: "Check this machine's internet connection, or ask again once online.",
            code: "WEB_RESEARCH_UNAVAILABLE",
          },
          { status: 503 },
        );
      }
      if (!resolveApiKey(settings)) {
        // No model: still surface the real retrieved sources instead of failing silently.
        const digest = bundle.sources
          .map((s, i) => `${i + 1}. ${s.title}\n   ${s.url}\n   ${s.snippet}`)
          .join("\n");
        await logCommand({
          command: input,
          type: "NETWORK",
          status: "SUCCESS",
          detail: `web.research (no model): ${bundle.sources.length} sources`,
          risk: "CONFIRM",
        });
        return NextResponse.json(
          {
            ...desktop,
            ok: true,
            title: "WEB RESEARCH",
            speak: `Found ${bundle.sources.length} live sources for "${bundle.query}". Configure an AI key for a written summary.`,
            detail: digest,
            data: { sources: bundle.sources, searchedAt: bundle.searchedAt, summarized: false, searchUrl: `https://www.google.com/search?q=${encodeURIComponent(bundle.query)}` },
            code: "WEB_RESEARCH_SOURCES_ONLY",
          },
          { status: 200 },
        );
      }
      const needsConsent = settings.aiAccess === "CONFIRM" && !body.confirmed;
      if (needsConsent) {
        return NextResponse.json(
          {
            ...desktop,
            requiresConfirmation: true,
            title: "WEB RESEARCH",
            speak: `Research "${bundle.query}" using ${bundle.sources.length} live sources and send them to ${settings.aiProvider} for a summary.`,
            verdict: {
              intentDescription: `Send retrieved web content to ${settings.aiProvider} (${settings.generalModel}) for summarisation`,
              reason: "Retrieved web page content is transmitted to the external AI provider.",
              affected: bundle.sources.map((s) => s.url).slice(0, 5).join(", "),
              level: "CONFIRM",
            },
            code: "CONFIRMATION_REQUIRED",
          },
          { status: 409 },
        );
      }
      await logCommand({
        command: input,
        type: "NETWORK",
        status: "SUCCESS",
        detail: `web.research: ${bundle.sources.length} sources retrieved`,
        risk: "CONFIRM",
      });
      return NextResponse.json(
        {
          ...desktop,
          ok: true,
          requiresAi: true,
          title: "WEB RESEARCH",
          task: "general",
          model: settings.generalModel,
          prompt: researchPrompt(bundle.query, category, bundle.context),
          speak: `Researching ${bundle.query} from ${bundle.sources.length} live sources.`,
          data: { sources: bundle.sources, searchedAt: bundle.searchedAt, summarized: true },
          code: "WEB_RESEARCH_SUMMARY",
        },
        { status: 200 },
      );
    }

    const status = desktop.blocked
      ? "BLOCKED"
      : desktop.requiresConfirmation
        ? "CONFIRM"
        : desktop.ok
          ? "SUCCESS"
          : "FAILED";
    await logCommand({
      command: input,
      type: desktopHistoryType(desktop.intent),
      status,
      detail: JSON.stringify({
        language: desktop.language,
        normalizedIntent: desktop.intent,
        understanding: desktop.understanding,
        executor: /vscode|code\./i.test(desktop.intent ?? "") ? "vscode" : "local",
        target: desktop.data?.absolutePath ?? desktop.data?.path ?? desktop.data?.workspace,
        result: desktop.speak,
        reason: desktop.reason,
      }),
      risk: desktop.blocked ? "BLOCK" : desktop.requiresConfirmation ? "CONFIRM" : "SAFE",
      durationMs: Date.now() - started,
    });
    const statusCode = desktop.blocked
      ? 403
      : desktop.requiresConfirmation
        ? 409
        : desktop.ok
          ? 200
          : /vscode|code\.create/i.test(desktop.intent ?? "")
            ? 503
            : 422;
    return NextResponse.json(
      {
        ...desktop,
        message: desktop.speak ?? desktop.reason ?? desktop.title,
        code: desktop.blocked
          ? "PERMISSION_DENIED"
          : desktop.requiresConfirmation
            ? "CONFIRMATION_REQUIRED"
            : desktop.ok
              ? "COMMAND_COMPLETED"
              : "LOCAL_EXECUTOR_FAILED",
        durationMs: Date.now() - started,
      },
      { status: statusCode },
    );
  }

  const detected = detectIntent(input);

  // -------------------------------------------------- AI-routed intents
  if (detected.route !== "LOCAL") {
    if (settings.aiAccess === "BLOCK") {
      await logCommand({ command: input, type: "SECURITY", status: "BLOCKED", detail: "AI access disabled", risk: "BLOCK" });
      return NextResponse.json({
        ok: false,
        blocked: true,
        error: "AI ENGINE DISABLED",
        reason: "AI ACCESS is set to BLOCK in the Security Center.",
        action: "Set AI ACCESS to ALLOWED or CONFIRMATION to use the heavy engine.",
      });
    }
    if (!resolveApiKey(settings)) {
      await logCommand({ command: input, type: "AI", status: "FAILED", detail: "no api key", durationMs: Date.now() - started });
      return NextResponse.json({
        ok: false,
        route: detected.route,
        error: "AI ENGINE OFFLINE",
        reason: "OPENROUTER_API_KEY is not configured.",
        action: "Add OPENROUTER_API_KEY to .env, or paste a key in Settings → AI Provider. All local commands remain available.",
        intent: detected.intent,
      });
    }
    const needsConsent = settings.aiAccess === "CONFIRM" && !body.confirmed;
    const verdict: SecurityVerdict = {
      level: "CONFIRM",
      reason: "Prompt and selected context will be transmitted to the configured external AI provider.",
      category: "PRIVACY",
      intentDescription: `Send request to ${settings.aiProvider} using ${
        detected.route === "DEVELOPER" ? settings.developerModel : settings.generalModel
      }`,
      affected: input.slice(0, 160),
    };
    if (needsConsent) {
      return NextResponse.json({
        ok: false,
        requiresConfirmation: true,
        route: detected.route,
        intent: detected.intent,
        verdict,
      });
    }
    return NextResponse.json({
      ok: true,
      route: detected.route,
      requiresAi: true,
      intent: detected.intent,
      task: detected.route === "DEVELOPER" ? "developer" : "general",
      model: detected.route === "DEVELOPER" ? settings.developerModel : settings.generalModel,
      prompt: detected.params.prompt ?? input,
    });
  }

  // ----------------------------------------------- local permission gate
  const verdict = localVerdict(detected, settings.fileAccess, settings.appLaunchAccess);
  if (verdict.level === "BLOCK") {
    await logCommand({ command: input, type: "SECURITY", status: "BLOCKED", detail: verdict.reason, risk: "BLOCK" });
    await logEvent({ type: "SECURITY_WARNING", level: "error", message: verdict.reason, meta: { input } });
    return NextResponse.json({ ok: false, blocked: true, error: "ACTION BLOCKED", reason: verdict.reason, action: "Restricted by the MR00100 security layer." });
  }
  if (verdict.level === "CONFIRM" && !body.confirmed) {
    await logCommand({ command: input, type: "SYSTEM", status: "CONFIRM", detail: verdict.intentDescription, risk: "CONFIRM" });
    return NextResponse.json({ ok: false, requiresConfirmation: true, intent: detected.intent, route: "LOCAL", verdict });
  }

  try {
    const result = await execute(detected, input);
    await logCommand({
      command: input,
      type: historyType(detected.intent),
      status: result.ok ? "SUCCESS" : "FAILED",
      detail: result.detail ?? result.reason,
      risk: verdict.level,
      durationMs: Date.now() - started,
    });
    return NextResponse.json({
      ok: result.ok,
      route: "LOCAL",
      intent: detected.intent,
      title: result.title,
      speak: result.speak,
      detail: result.detail,
      reason: result.reason,
      action: result.action,
      data: result.data,
      durationMs: Date.now() - started,
    });
  } catch (error) {
    const reason =
      error instanceof WorkspaceError
        ? error.reason
        : error instanceof Error
          ? error.message
          : "unknown failure";
    const action =
      error instanceof WorkspaceError ? error.action : "Check the target path or retry the command.";
    await logCommand({
      command: input,
      type: historyType(detected.intent),
      status: "FAILED",
      detail: reason,
      durationMs: Date.now() - started,
    });
    return NextResponse.json(
      {
        ok: false,
        route: "LOCAL",
        intent: detected.intent,
        error: "COMMAND FAILED",
        reason,
        action,
        speak: "That command failed. Check the error panel for details.",
      },
      { status: 200 },
    );
  }
}

function desktopHistoryType(intent?: string) {
  const value = intent ?? "";
  if (/(fs\.|code\.create)/.test(value)) return "FILE" as const;
  if (/(code\.|vscode)/.test(value)) return "DEVELOPER" as const;
  if (/(web\.|media\.)/.test(value)) return "NETWORK" as const;
  return "SYSTEM" as const;
}

function historyType(intent: string) {
  if (intent.startsWith("fs.")) return "FILE" as const;
  if (intent.startsWith("dev.")) return "DEVELOPER" as const;
  if (intent.startsWith("terminal.")) return "TERMINAL" as const;
  if (intent.startsWith("ai.")) return "AI" as const;
  return "SYSTEM" as const;
}

function localVerdict(
  detected: DetectedIntent,
  fileAccess: SecurityVerdict["level"],
  appAccess: SecurityVerdict["level"],
): SecurityVerdict {
  switch (detected.intent) {
    case "fs.delete":
      return classifyFileOperation("delete", detected.params.path ?? "", fileAccess);
    case "fs.create":
      return classifyFileOperation("create", detected.params.path ?? "", fileAccess);
    case "fs.read":
      return classifyFileOperation("read", detected.params.path ?? "", fileAccess);
    case "app.open":
      return classifyAppLaunch(detected.params.app ?? "", appAccess);
    case "app.close":
      return {
        level: "CONFIRM",
        reason: "Terminating an application may discard unsaved work.",
        category: "APP",
        intentDescription: `Force-close "${detected.params.app}" on the host machine`,
        affected: detected.params.app,
      };
    default:
      return {
        level: "SAFE",
        reason: "Read-only or inert local action",
        category: "LOCAL",
        intentDescription: detected.matchedText,
      };
  }
}

async function execute(detected: DetectedIntent, input: string): Promise<ToolResult> {
  const p = detected.params;
  switch (detected.intent) {
    case "system.info":
      return systemInfo(p.kind ?? "all");
    case "app.open":
      return launchApp(p.app ?? "");
    case "app.close":
      return closeApp(p.app ?? "");
    case "url.open":
      return openUrl(p.url ?? "");
    case "fs.list":
      return openFolder(p.path ?? ".");
    case "fs.search":
      return searchFiles(p.query ?? "");
    case "fs.read":
      return readFileTool(p.path ?? "");
    case "fs.create":
      return fileCreate(p.path ?? `untitled-${Date.now().toString(36)}.txt`, "");
    case "fs.delete":
      return fileDelete(p.path ?? "");
    case "clipboard.write":
      return clipboardWrite(p.text ?? "");
    case "clipboard.read":
      return clipboardRead();
    case "volume.set":
      return setVolume(Number(p.level ?? "50"));
    case "terminal.run":
      return {
        ok: true,
        title: "TERMINAL DISPATCH",
        speak: `Sending ${p.command} to the integrated terminal.`,
        detail: p.command,
        data: { runCommand: p.command, openPanel: "terminal" },
      };
    case "dev.open": {
      const overview = await workspaceOverview();
      return {
        ...overview,
        data: { ...((overview.data ?? {}) as object), openPanel: "developer", setMode: "developer" },
      };
    }
    case "dev.run":
      return {
        ok: true,
        title: "RUN PROJECT",
        speak: "Starting the project from the integrated terminal.",
        data: { runCommand: "npm start", openPanel: "developer", cwd: "demo-project" },
      };
    case "dev.build":
      return {
        ok: true,
        title: "BUILD PROJECT",
        speak: "Building the project.",
        data: { runCommand: "npm run build", openPanel: "developer", cwd: "demo-project", kind: "build" },
      };
    case "dev.test":
      return {
        ok: true,
        title: "RUN TESTS",
        speak: "Running the test suite.",
        data: { runCommand: "npm test", openPanel: "developer", cwd: "demo-project" },
      };
    case "ui.panel":
      return {
        ok: true,
        title: `OPEN ${(p.panel ?? "").toUpperCase()}`,
        speak: `Opening ${p.panel}.`,
        data: { openPanel: p.panel },
      };
    case "ui.mode":
      return {
        ok: true,
        title: `MODE ${(p.mode ?? "").toUpperCase()}`,
        speak: p.mode === "developer" ? "Developer mode engaged." : p.mode === "mini" ? "Switching to mini mode." : "Returning to command view.",
        data: { setMode: p.mode },
      };
    case "time.now": {
      const now = new Date();
      return {
        ok: true,
        title: "LOCAL TIME",
        speak: `It is ${now.toLocaleTimeString()} on ${now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}.`,
        detail: now.toISOString(),
      };
    }
    case "help":
      return { ok: true, title: "COMMAND REFERENCE", speak: "Here is what I can do locally without the AI engine.", detail: HELP_TEXT };
    default:
      return {
        ok: false,
        title: "UNROUTED COMMAND",
        speak: "I could not route that command locally.",
        reason: `No local handler for intent "${detected.intent}".`,
        action: "Rephrase, or enable the AI engine for open-ended requests.",
        detail: input,
      };
  }
}
