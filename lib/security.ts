import type { PermissionLevel } from "./config";

export type SecurityVerdict = {
  level: PermissionLevel;
  reason: string;
  category: string;
  /** Human readable description of exactly what will happen. */
  intentDescription: string;
  affected?: string;
};

/** Patterns that are never allowed to run, in any mode. */
const BLOCKED_PATTERNS: Array<{ re: RegExp; reason: string; category: string }> = [
  { re: /rm\s+(-[a-z]*\s+)*-?[rf]{1,2}\s+\/(?:\s|$)/i, reason: "Destructive root filesystem deletion", category: "DESTRUCTIVE" },
  { re: /mkfs(\.|\s)/i, reason: "Filesystem format attempt", category: "DESTRUCTIVE" },
  { re: /dd\s+if=.*of=\/dev\//i, reason: "Raw block device write", category: "DESTRUCTIVE" },
  { re: /:\s*\(\s*\)\s*\{.*\};\s*:/, reason: "Fork bomb signature", category: "DESTRUCTIVE" },
  { re: /format\s+[a-z]:/i, reason: "Drive format attempt", category: "DESTRUCTIVE" },
  { re: /del\s+\/[fsq]/i, reason: "Recursive forced Windows deletion", category: "DESTRUCTIVE" },
  { re: /(shutdown|reboot|halt|poweroff)\b/i, reason: "System power state change", category: "SYSTEM" },
  { re: /(\/etc\/shadow|\/etc\/passwd|id_rsa|id_ed25519|\.aws\/credentials|\.npmrc|keychain|Login Data|wallet\.dat)/i, reason: "Credential / secret material access", category: "CREDENTIALS" },
  { re: /(curl|wget)\s+[^|;]*\|\s*(sh|bash|zsh|python)/i, reason: "Remote script piped into a shell", category: "MALWARE" },
  { re: /(crontab\s+-|schtasks\s+\/create|reg\s+add\s+.*\\Run|systemctl\s+enable)/i, reason: "Stealth persistence mechanism", category: "PERSISTENCE" },
  { re: /(nc|netcat|ncat)\s+.*-e\s/i, reason: "Reverse shell signature", category: "MALWARE" },
  { re: /(mimikatz|lazagne|keylog|ransom|encrypt\s+all\s+files)/i, reason: "Known malicious tooling pattern", category: "MALWARE" },
  { re: /chmod\s+-R\s+777\s+\//, reason: "Global permission weakening", category: "SYSTEM" },
];

/** Read-only / inert commands that may run without confirmation. */
const SAFE_COMMAND_HEADS = new Set([
  "ls", "dir", "pwd", "cd", "cat", "type", "head", "tail", "wc", "echo",
  "whoami", "hostname", "uname", "date", "uptime", "df", "du", "free",
  "ps", "top", "env", "which", "where", "node", "npm", "npx", "pnpm", "yarn",
  "git", "python", "python3", "pip", "tsc", "eslint", "grep", "find", "tree",
  "curl", "ping", "printenv", "stat", "file", "sort", "uniq", "diff", "clear",
]);

/** Sub-commands that mutate state even under a safe head command. */
const MUTATING_SUBCOMMANDS: Record<string, string[]> = {
  npm: ["install", "i", "uninstall", "remove", "publish", "link", "update", "audit"],
  pnpm: ["install", "add", "remove", "publish", "update"],
  yarn: ["add", "remove", "publish", "upgrade"],
  git: ["push", "reset", "clean", "rebase", "checkout", "merge", "commit"],
  pip: ["install", "uninstall"],
};

export function classifyTerminalCommand(
  raw: string,
  terminalAccess: PermissionLevel,
): SecurityVerdict {
  const command = raw.trim();
  if (!command) {
    return {
      level: "BLOCK",
      reason: "Empty command",
      category: "INVALID",
      intentDescription: "No command supplied",
    };
  }

  for (const p of BLOCKED_PATTERNS) {
    if (p.re.test(command)) {
      return {
        level: "BLOCK",
        reason: p.reason,
        category: p.category,
        intentDescription: `Refused to execute: ${command}`,
        affected: command,
      };
    }
  }

  if (terminalAccess === "BLOCK") {
    return {
      level: "BLOCK",
      reason: "Terminal access is disabled in the Security Center",
      category: "POLICY",
      intentDescription: `Terminal execution of: ${command}`,
    };
  }

  const head = command.split(/\s+/)[0]?.replace(/^.*[\\/]/, "") ?? "";
  const sub = command.split(/\s+/)[1] ?? "";
  const hasShellChaining = /[;&|><`$]/.test(command);
  const mutating = (MUTATING_SUBCOMMANDS[head] ?? []).includes(sub);

  if (terminalAccess === "CONFIRM") {
    const inherentlySafe =
      SAFE_COMMAND_HEADS.has(head) && !hasShellChaining && !mutating;
    if (inherentlySafe) {
      return {
        level: "SAFE",
        reason: "Read-only inspection command",
        category: "TERMINAL",
        intentDescription: `Run \`${command}\` inside the workspace`,
        affected: command,
      };
    }
    return {
      level: "CONFIRM",
      reason: mutating
        ? "Command modifies packages or repository state"
        : hasShellChaining
          ? "Command uses shell chaining / redirection"
          : "Unrecognised executable",
      category: "TERMINAL",
      intentDescription: `Run \`${command}\` inside the workspace`,
      affected: command,
    };
  }

  // terminalAccess === "SAFE" → still confirm truly unknown binaries
  if (!SAFE_COMMAND_HEADS.has(head)) {
    return {
      level: "CONFIRM",
      reason: "Unrecognised executable",
      category: "TERMINAL",
      intentDescription: `Run \`${command}\` inside the workspace`,
      affected: command,
    };
  }
  return {
    level: "SAFE",
    reason: "Allowed by policy",
    category: "TERMINAL",
    intentDescription: `Run \`${command}\` inside the workspace`,
    affected: command,
  };
}

export type FileOperation =
  | "list"
  | "read"
  | "search"
  | "create"
  | "write"
  | "rename"
  | "move"
  | "copy"
  | "mkdir"
  | "delete";

export function classifyFileOperation(
  op: FileOperation,
  target: string,
  fileAccess: PermissionLevel,
  opts: { exists?: boolean } = {},
): SecurityVerdict {
  for (const p of BLOCKED_PATTERNS) {
    if (p.category === "CREDENTIALS" && p.re.test(target)) {
      return {
        level: "BLOCK",
        reason: p.reason,
        category: "CREDENTIALS",
        intentDescription: `Refused ${op} on protected path`,
        affected: target,
      };
    }
  }

  if (fileAccess === "BLOCK") {
    return {
      level: "BLOCK",
      reason: "File access disabled in the Security Center",
      category: "POLICY",
      intentDescription: `${op} ${target}`,
      affected: target,
    };
  }

  const readOnly = op === "list" || op === "read" || op === "search";
  if (readOnly) {
    return {
      level: fileAccess === "CONFIRM" ? "CONFIRM" : "SAFE",
      reason: readOnly ? "Read-only file operation" : "",
      category: "FILE",
      intentDescription: `${op.toUpperCase()} ${target || "workspace root"}`,
      affected: target,
    };
  }

  if (op === "delete") {
    return {
      level: "CONFIRM",
      reason: "Deletion cannot be undone",
      category: "FILE",
      intentDescription: `DELETE ${target} from the workspace`,
      affected: target,
    };
  }

  if (op === "write" && opts.exists) {
    return {
      level: "CONFIRM",
      reason: "Existing file will be overwritten",
      category: "FILE",
      intentDescription: `OVERWRITE ${target}`,
      affected: target,
    };
  }

  return {
    level: fileAccess === "CONFIRM" ? "CONFIRM" : "SAFE",
    reason: "Workspace-scoped mutation",
    category: "FILE",
    intentDescription: `${op.toUpperCase()} ${target}`,
    affected: target,
  };
}

const APP_BLOCKLIST = /(regedit|gpedit|cmd\s*\/c\s*del|powershell\s+-enc)/i;

export function classifyAppLaunch(
  app: string,
  appLaunchAccess: PermissionLevel,
): SecurityVerdict {
  if (APP_BLOCKLIST.test(app)) {
    return {
      level: "BLOCK",
      reason: "Application launch pattern is restricted",
      category: "SYSTEM",
      intentDescription: `Launch ${app}`,
      affected: app,
    };
  }
  return {
    level: appLaunchAccess === "SAFE" ? "SAFE" : appLaunchAccess,
    reason: appLaunchAccess === "SAFE" ? "Registered safe action" : "Policy requires confirmation",
    category: "APP",
    intentDescription: `Launch ${app} on the host machine`,
    affected: app,
  };
}
