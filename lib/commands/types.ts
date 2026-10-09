import type { PermissionLevel } from "../config";

export type CommandLanguage = "en" | "ur" | "roman" | "mixed";

export type FileScope = "workspace" | "desktop" | "downloads" | "documents" | "pictures" | "music" | "videos" | "host" | "project" | "vscode";

export type WorkspaceContext = {
  kind: "mr00100" | "windows" | "vscode";
  path?: string;
};

export type DesktopActionType =
  | "app.open"
  | "app.close"
  | "win.window.close"
  | "win.window.minimize"
  | "win.window.maximize"
  | "win.window.restore"
  | "win.window.focus"
  | "win.window.list"
  | "browser.tab.close"
  | "browser.window.close"
  | "browser.open.file"
  | "fs.save"
  | "os.explorer"
  | "os.folder"
  | "os.open"
  | "web.open"
  | "web.search"
  | "web.site.search"
  | "media.youtube.open"
  | "media.youtube.search"
  | "media.youtube.play"
  | "vscode.open"
  | "code.create"
  | "code.write"
  | "code.run"
  | "win.settings"
  | "win.startmenu"
  | "win.controlpanel"
  | "win.search"
  | "win.recyclebin"
  | "win.recyclebin.empty"
  | "win.recyclebin.restore"
  | "fs.back"
  | "fs.open.typed"
  | "win.power"
  | "win.drives"
  | "win.info"
  | "win.gpu"
  | "identity.answer"
  | "web.research"
  | "ui.panel"
  | "fs.create"
  | "fs.mkdir"
  | "fs.open"
  | "fs.read"
  | "fs.append"
  | "fs.edit"
  | "fs.listdir"
  | "fs.searchhost"
  | "fs.rename"
  | "fs.copy"
  | "fs.move"
  | "fs.delete";

export type DesktopAction = {
  type: DesktopActionType;
  params: Record<string, string>;
};

export type ParsedPlan = {
  language: CommandLanguage;
  original: string;
  normalized: string;
  actions: DesktopAction[];
  understanding: string;
  confidence: number;
};

export type CommandStage = "COMMAND" | "UNDERSTANDING" | "EXECUTING" | "SEARCHING" | "SUCCESS" | "COMPLETED" | "FAILED";

export type CommandTrace = {
  command: string;
  language: CommandLanguage | "unknown";
  understanding: string;
  stage: CommandStage;
  detail: string;
};

export type ActionResult = {
  ok: boolean;
  title: string;
  speak: string;
  detail?: string;
  reason?: string;
  action?: string;
  data?: Record<string, unknown>;
};

export type PermissionDecision = {
  level: PermissionLevel;
  reason: string;
  category: string;
  intentDescription: string;
  affected?: string;
};
