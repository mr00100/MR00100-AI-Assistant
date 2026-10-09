import type { AssistantSettings } from "../config";
import { classifyAppLaunch, classifyFileOperation, classifyTerminalCommand } from "../security";
import type { DesktopAction, PermissionDecision } from "./types";

export function classifyAction(
  action: DesktopAction,
  settings: AssistantSettings,
  options: { exists?: boolean } = {},
): PermissionDecision {
  const p = action.params;
  switch (action.type) {
    case "app.open":
    case "vscode.open":
      return classifyAppLaunch(p.app || "vscode", settings.appLaunchAccess);
    case "app.close":
      return {
        level: "CONFIRM",
        reason: "Terminating an application may discard unsaved work.",
        category: "APP",
        intentDescription: `Force-close "${p.app}"`,
        affected: p.app,
      };
    // Window lifecycle uses the graceful WM_CLOSE path, so apps can still
    // prompt to save. Ordinary open/close/minimize is a normal desktop action.
    case "win.window.close":
    case "win.window.minimize":
    case "win.window.maximize":
    case "win.window.restore":
    case "win.window.focus":
    case "win.window.list":
    case "browser.tab.close":
    case "browser.window.close":
      return {
        level: p.all === "1" && action.type !== "win.window.list" ? "CONFIRM" : "SAFE",
        reason:
          p.all === "1"
            ? "This affects every matching window at once."
            : "Reversible window operation; applications can still prompt to save.",
        category: "WINDOW",
        intentDescription: describe(action),
        affected: p.application || p.site || (p.contextual === "1" ? "the active window" : undefined),
      };
    case "os.explorer":
    case "os.folder":
    case "os.open":
    case "web.open":
    case "web.search":
    case "media.youtube.search":
    case "media.youtube.play":
      return {
        level: settings.networkAccess === "BLOCK" && action.type.startsWith("web")
          ? "BLOCK"
          : settings.networkAccess === "BLOCK" && action.type.startsWith("media")
            ? "BLOCK"
            : "SAFE",
        reason: "Open application, folder, or website",
        category: action.type.startsWith("media") || action.type.startsWith("web") ? "WEB" : "OS",
        intentDescription: describe(action),
        affected: p.app || p.site || p.query || p.folder || p.descriptor || p.path,
      };
    case "fs.delete":
      return classifyFileOperation("delete", p.path || "", settings.fileAccess);
    case "code.create":
    case "code.write":
    case "fs.create":
      return options.exists
        ? classifyFileOperation("write", p.path || "target file", settings.fileAccess, { exists: true })
        : classifyFileOperation("create", p.path || p.language || "new file", settings.fileAccess);
    case "fs.mkdir":
      return classifyFileOperation("mkdir", p.path || "new directory", settings.fileAccess);
    case "fs.rename":
      return classifyFileOperation("rename", `${p.path} -> ${p.to}`, settings.fileAccess);
    case "fs.copy":
      return classifyFileOperation("copy", `${p.path} -> ${p.to}`, settings.fileAccess);
    case "fs.move":
      return classifyFileOperation("move", `${p.path} -> ${p.to}`, settings.fileAccess);
    case "code.run": {
      if (settings.terminalAccess === "BLOCK") {
        return classifyTerminalCommand(p.command || "run selected code", "BLOCK");
      }
      return {
        level: "CONFIRM",
        reason: "Running a program executes project code and may modify files or contact services.",
        category: "EXECUTION",
        intentDescription: describe(action),
        affected: p.path || p.command || p.kind,
      };
    }
    case "win.power":
      if (p.action === "lock" || p.action === "cancel") {
        return {
          level: "SAFE",
          reason: p.action === "lock" ? "Locking is reversible by signing in." : "Cancelling a pending shutdown is protective.",
          category: "POWER",
          intentDescription: describe(action),
          affected: p.action,
        };
      }
      return {
        level: "CONFIRM",
        reason:
          p.action === "signout"
            ? "Signing out closes the current user session."
            : "This will interrupt your work and affect every running application.",
        category: "POWER",
        intentDescription: describe(action),
        affected: p.action,
      };
    case "win.recyclebin.empty":
      return {
        level: "CONFIRM",
        reason: "Emptying the Recycle Bin permanently removes deleted items and they cannot be restored.",
        category: "DESTRUCTIVE",
        intentDescription: describe(action),
        affected: "Recycle Bin",
      };
    case "win.recyclebin.restore":
    case "fs.back":
    case "fs.open.typed":
      return {
        level: "SAFE",
        reason: "Non-destructive navigation or restore operation.",
        category: "FILE",
        intentDescription: describe(action),
        affected: p.name || p.kind,
      };
    case "win.drives":
    case "win.info":
    case "win.gpu":
    case "win.startmenu":
    case "win.search":
    case "win.settings":
    case "win.controlpanel":
    case "win.recyclebin":
    case "identity.answer":
    case "web.research":
      return {
        level: settings.networkAccess === "BLOCK" && action.type === "web.research" ? "BLOCK" : "SAFE",
        reason: action.type === "web.research" ? "Read-only internet research" : "Read-only or reversible local action",
        category: action.type === "web.research" ? "WEB" : "WINDOWS",
        intentDescription: describe(action),
        affected: p.query || p.subject || p.action,
      };
    case "fs.append":
    case "fs.edit":
      return classifyFileOperation("write", p.path || "target file", settings.fileAccess, { exists: true });
    case "fs.save":
    case "browser.open.file":
      return {
        level: "SAFE",
        reason: "Saving the already-written file or previewing it in the browser.",
        category: "FILE",
        intentDescription: describe(action),
        affected: p.path,
      };
    case "fs.listdir":
    case "fs.searchhost":
      return classifyFileOperation("list", p.path || p.query || ".", settings.fileAccess);
    case "fs.create":
      return classifyFileOperation("create", p.path || "new file", settings.fileAccess);
    default:
      return {
        level: "SAFE",
        reason: "Read-only or inert local action",
        category: "LOCAL",
        intentDescription: describe(action),
      };
  }
}

export function describe(action: DesktopAction): string {
  const p = action.params;
  switch (action.type) {
    case "app.open":
      return `Launch ${p.app}`;
    case "app.close":
      return `Close ${p.app}`;
    case "win.window.close":
      return `Close ${p.all === "1" ? "all " : ""}${p.application ?? "the active"} window${p.all === "1" ? "s" : ""}${p.titleContains ? ` showing ${p.titleContains}` : ""}`;
    case "win.window.minimize":
      return `Minimize ${p.application ?? "the active"} window`;
    case "win.window.maximize":
      return `Maximize ${p.application ?? "the active"} window`;
    case "win.window.restore":
      return `Restore ${p.application ?? "the active"} window`;
    case "win.window.focus":
      return `Focus ${p.application ?? "the active"} window`;
    case "win.window.list":
      return "List open windows";
    case "browser.tab.close":
      return `Close ${p.all === "1" ? "all browser tabs" : p.site ? `the ${p.site} tab` : "the current browser tab"}`;
    case "browser.window.close":
      return `Close ${p.all === "1" ? "all " : "the "}${p.application ?? "browser"} window${p.all === "1" ? "s" : ""}`;
    case "os.explorer":
      return p.descriptor ? `Open File Explorer at ${p.descriptor}` : "Open Windows File Explorer";
    case "os.folder":
      return `Open folder ${p.descriptor ?? "Downloads"}`;
    case "os.open":
      return p.pronoun ? "Open the current folder/file" : `Open ${p.descriptor ?? "target"}`;
    case "web.open":
      return `Open ${p.site}`;
    case "web.search":
      return `Search the web for ${p.query}`;
    case "web.site.search":
      return `Search the current website for ${p.query}`;
    case "media.youtube.open":
      return "Open YouTube";
    case "media.youtube.search":
      return `Search YouTube for ${p.query}`;
    case "media.youtube.play":
      return `Play ${p.query} on YouTube`;
    case "win.settings":
      return p.subject && p.subject !== "settings" ? `Open Windows Settings → ${p.subject}` : "Open Windows Settings";
    case "win.startmenu":
      return "Open the Windows Start menu";
    case "win.controlpanel":
      return "Open Windows Control Panel";
    case "win.search":
      return `Open Windows Search for ${p.query}`;
    case "win.recyclebin":
      return "Open the Windows Recycle Bin";
    case "win.recyclebin.empty":
      return "Empty the Windows Recycle Bin (permanent)";
    case "win.recyclebin.restore":
      return p.name ? `Restore ${p.name} from the Recycle Bin` : "Restore the most recently deleted item";
    case "fs.back":
      return "Go back to the previous folder";
    case "fs.open.typed":
      return `Open the ${p.kind}${p.folder ? ` in ${p.folder}` : ""}`;
    case "win.power":
      return `Power action: ${p.action}`;
    case "win.drives":
      return "List available drives";
    case "win.info":
      return "Read Windows system information";
    case "win.gpu":
      return "Read GPU information";
    case "identity.answer":
      return "State MR00100 identity";
    case "web.research":
      return `Research on the internet: ${p.query}`;
    case "fs.save":
      return "Save the current file";
    case "browser.open.file":
      return "Open the current file in the browser";
    case "fs.append":
      return `Append to ${p.path}`;
    case "fs.edit":
      return `Edit ${p.path}`;
    case "fs.listdir":
      return `List files in ${p.path || "the target folder"}`;
    case "fs.searchhost":
      return `Search for files matching ${p.query}`;
    case "vscode.open":
      if (p.path) return `Open ${p.path} in VS Code`;
      if (p.folderDescriptor) return `Open ${p.folderDescriptor} in VS Code`;
      if (p.useLast) return "Open the current project in VS Code";
      return "Open VS Code";
    case "code.create":
      return `Create ${p.language || "code"} file${p.path ? ` ${p.path}` : ""}${p.folderDescriptor ? ` in ${p.folderDescriptor}` : p.scope === "vscode" ? " in the VS Code workspace" : ""}`;
    case "code.run":
      return `Run ${p.command || p.kind || "program"}`;
    case "fs.delete":
      return `Delete ${p.path}`;
    case "fs.create":
      return `Create file ${p.path}`;
    case "fs.mkdir":
      return `Create folder ${p.path}`;
    case "fs.rename":
      return `Rename ${p.path} to ${p.to}`;
    case "fs.copy":
      return `Copy ${p.path} to ${p.to}`;
    case "fs.move":
      return `Move ${p.path} to ${p.to}`;
    case "fs.open":
      return `Open ${p.path}`;
    default:
      return action.type;
  }
}

export function combineDecisions(list: PermissionDecision[]): PermissionDecision {
  if (list.some((d) => d.level === "BLOCK")) {
    const blocked = list.find((d) => d.level === "BLOCK")!;
    return blocked;
  }
  if (list.some((d) => d.level === "CONFIRM")) {
    return {
      level: "CONFIRM",
      reason: list.filter((d) => d.level === "CONFIRM").map((d) => d.reason).join("; "),
      category: "PLAN",
      intentDescription: list.map((d) => d.intentDescription).join("\n"),
      affected: list.map((d) => d.affected).filter(Boolean).join(", "),
    };
  }
  return {
    level: "SAFE",
    reason: "Safe local actions",
    category: "PLAN",
    intentDescription: list.map((d) => d.intentDescription).join("\n"),
  };
}
