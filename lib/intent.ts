/**
 * MR00100 command router — intent detection.
 *
 * Simple, deterministic and zero-cost: no AI model is loaded for local
 * intents. Only unmatched / clearly cognitive requests are routed to the
 * heavy AI engine.
 */

export type IntentName =
  | "system.info"
  | "app.open"
  | "app.close"
  | "url.open"
  | "fs.list"
  | "fs.search"
  | "fs.read"
  | "fs.create"
  | "fs.delete"
  | "clipboard.write"
  | "clipboard.read"
  | "volume.set"
  | "terminal.run"
  | "dev.open"
  | "dev.run"
  | "dev.build"
  | "dev.test"
  | "ui.panel"
  | "ui.mode"
  | "time.now"
  | "help"
  | "ai.ask"
  | "ai.code";

export type RouteTarget = "LOCAL" | "AI" | "DEVELOPER";

export type DetectedIntent = {
  intent: IntentName;
  route: RouteTarget;
  params: Record<string, string>;
  matchedText: string;
  confidence: number;
};

const WAKE = /^\s*(mr\s*0{2}\s*100|mr00100|mister 00100|mr one hundred)[\s,:-]*/i;

export function stripWakeWord(input: string): string {
  return input.replace(WAKE, "").trim();
}

export function hasWakeWord(input: string): boolean {
  return WAKE.test(input);
}

const AI_HINTS =
  /(explain|why|how do|refactor|debug|fix|optimi[sz]e|architecture|analy[sz]e|review|generate|write (me )?(a|an|some)? ?(code|function|class|component|script)|implement|unit test|typescript error|stack trace|design|plan|summari[sz]e|translate|document)/i;

const CODE_HINTS =
  /(code|function|component|typescript|javascript|python|react|next\.?js|api|bug|error|compile|build fail|refactor|class |import |async |regex)/i;

export function detectIntent(rawInput: string): DetectedIntent {
  const input = stripWakeWord(rawInput).trim();
  const lower = input.toLowerCase();
  const mk = (
    intent: IntentName,
    route: RouteTarget,
    params: Record<string, string> = {},
    confidence = 0.9,
  ): DetectedIntent => ({ intent, route, params, matchedText: input, confidence });

  if (!input) return mk("help", "LOCAL", {}, 0.4);

  // ---------------------------------------------------------------- system
  let m = lower.match(/\b(cpu|processor)\b.*\b(usage|load|status|temperature|percent)?/);
  if (m && /(usage|load|status|check|what|how|show|percent|monitor)/.test(lower) && /\b(cpu|processor)\b/.test(lower))
    return mk("system.info", "LOCAL", { kind: "cpu" });
  if (/\b(ram|memory)\b/.test(lower) && /(usage|free|status|check|what|how|show|much)/.test(lower))
    return mk("system.info", "LOCAL", { kind: "ram" });
  if (/\b(disk|storage|drive|ssd)\b/.test(lower) && /(usage|space|free|status|check|show)/.test(lower))
    return mk("system.info", "LOCAL", { kind: "disk" });
  if (/\b(network|internet|connection|wifi|latency|ping)\b/.test(lower) && /(status|speed|check|show|up|down|online)/.test(lower))
    return mk("system.info", "LOCAL", { kind: "network" });
  if (/\bbattery\b/.test(lower)) return mk("system.info", "LOCAL", { kind: "battery" });
  if (/\b(process|processes|task manager|running apps)\b/.test(lower))
    return mk("system.info", "LOCAL", { kind: "process" });
  if (/\b(system (info|status|overview)|how is (my|the) (pc|system|computer)|status report|diagnostics)\b/.test(lower))
    return mk("system.info", "LOCAL", { kind: "all" });

  // ------------------------------------------------------------------- ui
  // Real Windows apps (terminal, explorer, files, settings) are handled by the
  // desktop router. Internal MR00100 panels for those need the explicit
  // "mr00100" / "internal" / "assistant" qualifier; other panels stay direct.
  const internalQualified = /\b(mr00100|internal|assistant|jarvis)\b/.test(lower);
  const panelWords = internalQualified
    ? "chat|terminal|files?|file manager|explorer|system|security|settings|memory|developer|dev mode|camera|history"
    : "chat|system|security|memory|developer|dev mode|camera|history";
  m = lower.match(new RegExp(`\\b(open|show|display|activate)\\s+(the\\s+)?(?:mr00100\\s+|internal\\s+|assistant\\s+|jarvis\\s+)?(${panelWords})\\b`));
  if (m) {
    const raw = m[3];
    const panel =
      raw.startsWith("file") || raw === "explorer" || raw === "file manager"
        ? "files"
        : raw === "dev mode"
          ? "developer"
          : raw;
    if (panel === "developer") return mk("ui.mode", "LOCAL", { mode: "developer" });
    return mk("ui.panel", "LOCAL", { panel });
  }
  if (/\b(mini ?mode|compact mode)\b/.test(lower)) return mk("ui.mode", "LOCAL", { mode: "mini" });
  if (/\b(developer mode|dev mode|coding mode|workspace)\b/.test(lower) && /(enter|open|activate|switch|start|enable)/.test(lower))
    return mk("ui.mode", "LOCAL", { mode: "developer" });
  if (/\b(normal mode|exit developer|leave dev|back to (main|core))\b/.test(lower))
    return mk("ui.mode", "LOCAL", { mode: "normal" });

  // ----------------------------------------------------------------- apps
  m = input.match(/\b(?:open|launch|start|run)\s+(?:the\s+)?(?:app\s+)?([a-z0-9 .+-]{2,30}?)(?:\s+(?:app|application|please|now))?$/i);
  if (m && !/\b(file|folder|project|terminal|chat|settings|url|website|site|test|build|dev server)\b/i.test(m[1])) {
    const app = m[1].trim();
    if (/^(https?:\/\/|www\.)/i.test(app) || /\.(com|net|org|io|dev|ai|co)\b/i.test(app))
      return mk("url.open", "LOCAL", { url: app });
    return mk("app.open", "LOCAL", { app });
  }
  m = input.match(/\b(?:close|quit|kill|terminate|exit)\s+(?:the\s+)?([a-z0-9 .+-]{2,30})$/i);
  if (m) return mk("app.close", "LOCAL", { app: m[1].trim() });

  // ------------------------------------------------------------------ url
  m = input.match(/\b(?:open|go to|navigate to|browse)\s+((?:https?:\/\/)?[a-z0-9-]+\.[a-z]{2,}[^\s]*)/i);
  if (m) return mk("url.open", "LOCAL", { url: m[1] });

  // ----------------------------------------------------------------- files
  m = input.match(/\b(?:create|make|new)\s+(?:a\s+)?(?:new\s+)?(?:file|python file|js file|text file)\s+(?:called\s+|named\s+)?([\w./-]+)/i);
  if (m) return mk("fs.create", "LOCAL", { path: m[1] });
  m = input.match(/\b(?:create|make)\s+(?:a\s+)?(?:new\s+)?(python|javascript|typescript|text|markdown)\s+file\b/i);
  if (m) {
    const ext = { python: "py", javascript: "js", typescript: "ts", text: "txt", markdown: "md" }[
      m[1].toLowerCase()
    ];
    return mk("fs.create", "LOCAL", { path: `untitled-${Date.now().toString(36)}.${ext}` });
  }
  m = input.match(/\b(?:delete|remove)\s+(?:the\s+)?(?:file|folder|directory)?\s*([\w./-]+)/i);
  if (m && /\b(delete|remove)\b/.test(lower)) return mk("fs.delete", "LOCAL", { path: m[1] });
  m = input.match(/\b(?:search|find|locate)\s+(?:for\s+)?(?:files?\s+)?(?:named\s+|called\s+|matching\s+)?["']?([\w.*-]{2,40})["']?/i);
  if (m && /\b(file|files|search|find|locate)\b/.test(lower)) return mk("fs.search", "LOCAL", { query: m[1] });
  m = input.match(/\b(?:read|open|show|cat)\s+(?:the\s+)?file\s+([\w./-]+)/i);
  if (m) return mk("fs.read", "LOCAL", { path: m[1] });
  m = input.match(/\b(?:open|list|show)\s+(?:the\s+)?(?:folder|directory|dir)\s+([\w./-]+)/i);
  if (m) return mk("fs.list", "LOCAL", { path: m[1] });
  if (/\b(list|show)\s+(my\s+)?(files|workspace|project files)\b/.test(lower))
    return mk("fs.list", "LOCAL", { path: "." });
  if (/\bopen (my|the) project\b/.test(lower)) return mk("dev.open", "LOCAL", {});

  // ------------------------------------------------------------- clipboard
  m = input.match(/\bcopy\s+["'](.+)["']\s+to (the )?clipboard/i);
  if (m) return mk("clipboard.write", "LOCAL", { text: m[1] });
  if (/\b(read|show|what.s in|paste)\b.*\bclipboard\b/.test(lower)) return mk("clipboard.read", "LOCAL", {});

  // ----------------------------------------------------------------- audio
  m = lower.match(/\b(?:set\s+)?volume\s+(?:to\s+)?(\d{1,3})\s*%?/);
  if (m) return mk("volume.set", "LOCAL", { level: m[1] });
  if (/\b(mute|silence)\b/.test(lower)) return mk("volume.set", "LOCAL", { level: "0" });

  // -------------------------------------------------------------- terminal
  m = input.match(/\b(?:run|execute)\s+(?:the\s+)?(?:command|cmd|terminal command)\s+["`]?(.+?)["`]?$/i);
  if (m) return mk("terminal.run", "LOCAL", { command: m[1] });
  m = input.match(/^(?:run|execute)\s+((?:npm|npx|node|git|python|python3|ls|cat|pwd|tsc|pnpm|yarn)\s+.+)$/i);
  if (m) return mk("terminal.run", "LOCAL", { command: m[1] });

  // ------------------------------------------------------------- developer
  if (/\b(build|compile)\b.*\b(project|app|it)?\b/.test(lower) && /\b(build|compile)\b/.test(lower) && !AI_HINTS.test(lower))
    return mk("dev.build", "LOCAL", {});
  if (/\b(run|start)\b.*\b(project|dev server|app|tests?)\b/.test(lower)) {
    if (/\btests?\b/.test(lower)) return mk("dev.test", "LOCAL", {});
    return mk("dev.run", "LOCAL", {});
  }
  if (/\b(open|load)\b.*\bproject\b/.test(lower)) return mk("dev.open", "LOCAL", {});

  // ------------------------------------------------------------------ misc
  if (/\b(what.?s the time|what time is it|current time|today.?s date|what.?s the date)\b/.test(lower))
    return mk("time.now", "LOCAL", {});
  if (/\b(help|what can you do|commands|capabilities)\b/.test(lower)) return mk("help", "LOCAL", {});

  // -------------------------------------------------------------------- AI
  if (CODE_HINTS.test(lower) || /```/.test(input)) return mk("ai.code", "DEVELOPER", { prompt: input }, 0.7);
  if (AI_HINTS.test(lower) || input.split(/\s+/).length > 6)
    return mk("ai.ask", "AI", { prompt: input }, 0.6);

  return mk("ai.ask", "AI", { prompt: input }, 0.4);
}

export const HELP_TEXT = `MR00100 AI — local command set (English, Roman Urdu, Urdu):
• "open chrome" / "Chrome kholo" / "کروم کھولو"
• "open file explorer" / "file explorer kholo" / "Downloads kholo"
• "open YouTube" / "Arijit Singh ka song play karo"
• "VS Code kholo" / "VS Code mein Python ki file banao"
• "run karo" / "npm run dev"
• "check my CPU usage" / "create a python file" / "open terminal"
Cognitive tasks still activate the heavy AI engine on demand.`;
