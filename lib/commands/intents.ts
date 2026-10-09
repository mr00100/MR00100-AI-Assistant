import { detectLanguage, normalizeCommand, splitCompound } from "./normalizer";
import type { DesktopAction, FileScope, ParsedPlan } from "./types";
import { LANGUAGE_EXT, extFor, languageFromExt } from "./templates";
import { matchCatalog } from "../windows/apps";
import { knownSite, looksLikeUrl } from "../browser/navigation";
import { classifyResearch, isIdentityQuestion } from "./knowledge";
import { isWindowListQuery, parseWindowIntent } from "./window-intent";

const SETTINGS_WORDS =
  "display|screen|sound|audio|network|internet|wifi|wi fi|wi-fi|bluetooth|update|updates|personalization|themes|apps|privacy|security|activation|power|storage|accounts|default apps|keyboard|mouse|touchpad|time|date|language|region|about|system|power plan|battery|notifications|installed apps";

const POWER_WORDS: Record<string, string> = {
  shutdown: "shutdown",
  "shut down": "shutdown",
  restart: "restart",
  reboot: "restart",
  sleep: "sleep",
  hibernate: "hibernate",
  lock: "lock",
  "sign out": "signout",
  logout: "signout",
  "log out": "signout",
  cancel: "cancel",
};

const USER_DIRS = new Set(["pictures", "music", "videos", "downloads", "download", "desktop", "documents", "document", "workspace", "home"]);

function escapeRe(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const LANG_RE = new RegExp(
  `\\b(${Object.keys(LANGUAGE_EXT)
    .sort((a, b) => b.length - a.length)
    .map(escapeRe)
    .join("|")})\\b`,
  "i",
);

const SPECIAL_FOLDERS = new Set(["downloads", "download", "desktop", "documents", "document", "pictures", "music", "videos", "workspace", "home"]);

function windowsSettingsIntent(t: string): DesktopAction[] | null {
  // Internal MR00100 settings must never be confused with Windows Settings.
  if (/\bmr00100\b/.test(t) && /\bsettings?\b/.test(t)) return null;
  if (!/\bsettings?\b/.test(t)) return null;

  if (new RegExp(`\\b(${SETTINGS_WORDS})\\b`).test(t)) {
    const subject = t
      .replace(/\b(open|launch|start|show|go to|settings?|window|kholo|kar do|kar|karo|please|the|my|pc|computer)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return [{ type: "win.settings", params: { subject: subject || "settings" } }];
  }
  // Plain "settings", "windows settings", "pc settings" (with optional trailing verb).
  if (/^(open |show |launch |go to )?(windows |pc |my |the )*settings?\s*(open|launch|show|start)?$/.test(t)) {
    return [{ type: "win.settings", params: { subject: "settings" } }];
  }
  return null;
}

function powerIntent(t: string): DesktopAction[] | null {
  const cancel = /\b(cancel|abort|stop)\b.*\b(shutdown|restart|reboot|power)\b/.test(t);
  if (cancel) return [{ type: "win.power", params: { action: "cancel" } }];
  for (const [word, action] of Object.entries(POWER_WORDS)) {
    if (!new RegExp(`\\b${word}\\b`).test(t)) continue;
    if (action === "cancel") continue;
    const subject = t.replace(/\b(please|pc|computer|laptop|system|now|kar do|kar|karo|kholo|my|the)\b/g, " ").replace(/\s+/g, " ").trim();
    if (/\b(open|close|create|write|file|folder)\b/.test(subject)) continue;
    return [{ type: "win.power", params: { action } }];
  }
  return null;
}

function fileOperationIntent(t: string, ctx: { vscode?: boolean }): DesktopAction[] | null {
  const scope = scopeFrom(t);

  const append = t.match(/\b(append|add|write)\b.*\b(to|in|into)\b.*\b(file|index|readme|\w+\.\w+)\b/);
  if (/\bappend\b/.test(t)) {
    const target = filenameFrom(t) ?? "";
    if (target) return [{ type: "fs.append", params: { path: target, scope, text: t } }];
  }

  const showFiles = t.match(/\b(show|list|display)\b.*\b(files|folders|contents|directory|dir)\b/);
  if (showFiles || /\b(show|list)\b.*\bfiles?\b/.test(t)) {
    const dir = extractAbsolutePath(t)?.path ?? takeAfter(t, /\b(?:in|of|from)\s+(.+)$/) ?? "";
    return [{ type: "fs.listdir", params: { path: dir.replace(/\b(files?|folders?|contents|directory|dir)\b/g, "").trim(), scope } }];
  }

  const searchFiles = t.match(/\b(find|search|locate)\b.*\bfiles?\b/);
  const explicitFileQuery = Boolean(filenameFrom(t)) || /\b(file|folder|directory)\b/.test(t);
  if (searchFiles || (explicitFileQuery && /\b(find|search|locate)\b/.test(t) && !/\b(google|web|youtube|internet)\b/.test(t))) {
    const q = filenameFrom(t) ?? takeAfter(t, /\b(?:named|called|matching|like)\s+(.+)$/) ?? t.replace(/^\s*(find|search|locate)\s*(files?\s*)?/, "").trim();
    if (q) return [{ type: "fs.searchhost", params: { query: q, scope } }];
  }

  const rename = t.match(/\brename\b\s+(\S+)\s+(?:to|as)\s+(\S+)/);
  if (rename) return [{ type: "fs.rename", params: { path: rename[1], to: rename[2], scope } }];

  const copyTo = t.match(/\b(?:copy)\b\s+(\S+)\s+to\s+(.+)$/);
  if (copyTo) {
    const dest = copyTo[2].replace(/\s*folder$/i, "").trim();
    return [{ type: "fs.copy", params: { path: copyTo[1], to: dest, scope } }];
  }
  const moveTo = t.match(/\b(?:move|shift)\b\s+(.+?)\s+to\s+(.+)$/);
  if (moveTo) {
    const source = moveTo[1].replace(/\bfolder\b/i, "").trim();
    return [{ type: "fs.move", params: { path: source, to: moveTo[2].replace(/\s*folder$/i, "").trim(), scope } }];
  }

  if (/\b(edit|modify|change|update)\b/.test(t) && filenameFrom(t)) {
    return [{ type: "fs.edit", params: { path: filenameFrom(t)!, scope, hint: t } }];
  }
  return null;
}

function systemInfoIntent(t: string): DesktopAction[] | null {
  // "open C drive" navigates Explorer; only list/show phrases enumerate drives.
  const driveOpen = /^(open|go to|show)\b/.test(t) && /\b[a-z]\s*drive\b|\bdrives?\b/.test(t);
  if (/\b(drives?|volumes?|partitions?)\b/.test(t) && !driveOpen && /\b(list|show|check|what|which)\b/.test(t)) {
    return [{ type: "win.drives", params: {} }];
  }
  if (/\b(gpu|graphics card|display adapter|video card)\b/.test(t)) {
    return [{ type: "win.gpu", params: {} }];
  }
  if (/\b(windows version|operating system|system information|system specs|what windows|my pc|about this pc|specs)\b/.test(t)) {
    return [{ type: "win.info", params: {} }];
  }
  return null;
}
const CODE_EXTS = new Set(["py", "js", "jsx", "ts", "tsx", "html", "css", "c", "cpp", "java", "cs", "php", "sql", "go", "rs", "json", "md"]);

/** Pull a real absolute path (Windows drive / UNC / tilde / POSIX root) out of natural language. */
function extractAbsolutePath(text: string): { path: string; rest: string } | null {
  const win = text.match(
    /([A-Za-z]:[\\/](?:[^<>"|?*\n]{2,}?))(?=\s+(?:in\s+(?:vs\s*code|vscode|visual studio code|explorer|browser|chrome|edge|notepad)\b)|\s+(?:and|then)\s+|$)/i,
  );
  if (win) {
    const abs = win[1].replace(/[\\/]+$/, "").trim();
    return { path: abs, rest: text.replace(win[1], " ").replace(/\s+/g, " ").trim() };
  }
  const unc = text.match(/(\\\\[^\s<>"|?*]+)/);
  if (unc) {
    return { path: unc[1], rest: text.replace(unc[1], " ").trim() };
  }
  const posix = text.match(/((?:~)?\/[\w.,:()[\]-]+(?:\/[\w.,:()[\]-]+)+)/);
  if (posix) {
    return { path: posix[1], rest: text.replace(posix[1], " ").trim() };
  }
  return null;
}

function scopeFrom(text: string): FileScope {
  if (wantsVsCode(text)) return "vscode";
  if (/\bdesktop\b/.test(text)) return "desktop";
  if (/\bdownloads?\b/.test(text)) return "downloads";
  if (/\bdocuments?\b/.test(text)) return "documents";
  if (/\bpictures\b/.test(text)) return "pictures";
  if (/\bmusic\b/.test(text)) return "music";
  if (/\bvideos\b/.test(text)) return "videos";
  if (/\b(workspace|mr00100\s*work\s*space)\b/.test(text)) return "workspace";
  if (/\bproject\b/.test(text)) return "project";
  return "workspace";
}

function explicitScopeFrom(text: string): FileScope | "" {
  if (/\bdesktop\b/.test(text)) return "desktop";
  if (/\bdownloads?\b/.test(text)) return "downloads";
  if (/\bdocuments?\b/.test(text)) return "documents";
  if (/\bpictures\b/.test(text)) return "pictures";
  if (/\bmusic\b/.test(text)) return "music";
  if (/\bvideos\b/.test(text)) return "videos";
  if (/\b(workspace|mr00100\s*work\s*space)\b/.test(text)) return "workspace";
  if (/\bproject\b/.test(text)) return "project";
  return "";
}

function filenameFrom(text: string): string | undefined {
  const named = text.match(/\b(?:called|named)\s+["'`]?([\w.\- /\\]+?)["'`]?(?=\s+(?:in|inside|on|with|and|then)\b|$)/i);
  if (named) return named[1].trim();
  const dotted = text.match(/([^\s]+?\.(?:py|js|jsx|ts|tsx|html|css|c|cpp|java|cs|php|sql|go|rs|json|md|txt))\b/i);
  if (dotted) return dotted[1];
  return undefined;
}

function fileExtOf(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

function languageFrom(text: string): string | undefined {
  const m = text.match(LANG_RE);
  return m?.[1]?.toLowerCase();
}

function wantsVsCode(text: string) {
  return /\b(vscode|vs code|visual studio code)\b/.test(text);
}

function hasPronoun(text: string) {
  return /\b(it|this|that|same|ye|ispe|isko)\b/.test(text);
}

/** Folder wording after an open/access verb: "mr00100 ai folder", "projects folder". */
function folderNameHint(text: string): string | null {
  const m = text.match(/^(?:open|access|go to|navigate to)\s+(?:the\s+)?([\w .\-]{1,60}?)\s+(?:folder|festival|directory)\b/i) ??
    text.match(/^([\w .\-]{1,60}?)\s+(?:folder|directory)(?:\s+(?:open|kholo))?$/i);
  if (!m) return null;
  const name = m[1].trim();
  if (!name || SPECIAL_FOLDERS.has(name)) return null;
  if (/^(file|windows|windows file)$/.test(name)) return null;
  return name;
}

function youtubeQuery(text: string): string {
  const q = text
    .replace(/\b(search|play|open|youtube|on youtube|on yt|song|songs|music|video|videos|for|the|on|in|this)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return q;
}

function searchQuery(text: string): string {
  return text
    .replace(/\b(search|google|web|internet|the web|browser|for|on|in|pe|please|the|about)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function codeCreationActions(rootNorm: string, rootOriginal: string, absPath: string | null): DesktopAction[] | null {
  const normalized = rootNorm;
  // Pure "open X" phrasing is never creation, even when X is a code file.
  if (/^\s*(open|launch|play|run|close|delete|search)\b/.test(normalized) && !/\b(create|make|write|generate)\b/.test(normalized)) return null;

  const explicitCreationVerb = /\b(create|make|write|generate)\b/.test(normalized);
  const newFilePhrase = /\bnew\b/.test(normalized) && /\b(file|program|code|script|component|folder)\b/.test(normalized);
  const creationVerb = explicitCreationVerb || newFilePhrase;
  const webSearch = /\b(search|google|youtube|browser|website search|web site)\b/.test(normalized) && !wantsVsCode(normalized);
  const filename = filenameFrom(rootOriginal) ?? filenameFrom(normalized);
  const explicitLanguage = languageFrom(normalized);
  const inferredLanguage = explicitLanguage ?? (filename ? languageFromExt(filename) : undefined);
  const pageRequest = /\b(login|sign in|web ?page|website|landing page)\b/.test(normalized);
  const codeSubject = /\b(file|program|code|page|website|webpage|script|component)\b/.test(normalized);
  const editorRequest = wantsVsCode(normalized) || wantsVsCode(rootOriginal.toLowerCase());

  if (!creationVerb || webSearch || (!codeSubject && !filename)) return null;

  const language = inferredLanguage ?? (pageRequest ? "html" : "text");
  const defaultName = pageRequest || language === "html" ? "index.html" : `main.${extFor(language)}`;
  const target = filename || defaultName;

  let folderDescriptor = absPath ?? "";
  if (!folderDescriptor && !/\bin this\b/.test(normalized)) {
    const inFolder = normalized.match(/\b(?:in|into|inside)\s+([\w .\-]{2,60})$/i);
    if (inFolder) {
      const cand = inFolder[1].trim();
      const isKnownScope = SPECIAL_FOLDERS.has(cand) || cand === "vscode" || cand === "vs code";
      const isFilename = /[\w-]+\.\w+$/.test(cand);
      const isPronoun = /\b(this|that|it|here|there)\b/.test(cand);
      if (!isKnownScope && !isFilename && !isPronoun) folderDescriptor = cand;
    }
  }

  // Empty scope lets the executor prefer the active project/session context.
  // "in this" means the folder/project we are already working in.
  const scope = absPath
    ? "vscode"
    : /\bin this\b/.test(normalized)
      ? "context"
      : explicitScopeFrom(normalized) || (editorRequest ? "vscode" : "");
  const actions: DesktopAction[] = [
    {
      type: "code.create",
      params: {
        language,
        path: target,
        hint: normalized,
        scope,
        folderDescriptor,
        openVscode: editorRequest ? "1" : "0",
      },
    },
  ];

  if (/\brun\b/.test(normalized)) {
    actions.push({ type: "code.run", params: { path: target, scope, kind: "file" } });
  }
  return actions;
}

function parseOne(rawText: string, ctx: { vscode?: boolean }, rootAbs: string | null): DesktopAction[] {
  const pre = rawText.trim();
  if (!pre) return [];

  // Absolute paths mentioned anywhere get attached to the relevant action.
  const abs = rootAbs ?? extractAbsolutePath(pre)?.path ?? null;
  const t = abs ? pre.replace(abs, " ").replace(/\s+/g, " ").trim() : pre;

  // ---------------------------------------------------------- VS Code targets
  const editorMention = wantsVsCode(t) || (abs ? /\b(vs code|vscode|visual studio code)\b/.test(pre) : false);
  const editorVerb = /\b(open|launch|start|go to)\b/.test(t) || /^(vs code|vscode)$/.test(t) || /\b(folder|project|directory)\b/.test(t);
  if (editorMention && editorVerb) {
    const openVerb = /\b(open|launch|start|go to)\b/.test(t);
    const folderArg =
      abs ??
      (t.match(/\bin\s+([\w .\-]{2,80}?)(?:\s+(?:open|please))?$/i)?.[1].replace(/\b(vscode|vs code|visual studio code)\b/gi, "").trim() ?? "");
    const file = filenameFrom(t);
    if (file && CODE_EXTS.has(fileExtOf(file))) {
      return [{ type: "vscode.open", params: { path: file, scope: scopeFrom(t) } }];
    }
    if (abs && !/\b(folder|directory)\b/.test(t)) {
      return [{ type: "vscode.open", params: { folderDescriptor: abs } }];
    }
    if (abs) return [{ type: "vscode.open", params: { folderDescriptor: abs } }];
    if (hasPronoun(t) && openVerb) {
      return [{ type: "vscode.open", params: { useLast: "1" } }];
    }
    const named = t
      .replace(/\b(open|launch|start|vs code|visual studio code|vscode|project|in|inside|the|on|kholo|karo|do)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (named && !/^(it|this|that|same)$/.test(named)) {
      return [{ type: "vscode.open", params: { folderDescriptor: named } }];
    }
    if (openVerb || t === "vs code" || t === "vscode") return [{ type: "vscode.open", params: {} }];
  }

  // Compound context: "... project ..." chunk following a VS Code verb targets that project.
  if (ctx.vscode && /\b(open|project|in)\b/.test(t) && /[a-z0-9]/i.test(t)) {
    const name = t
      .replace(/\b(open|launch|start|project|in|inside|the|on|karo|kholo|do|please|kholein)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (name && !knownSite(name) && !matchCatalog(name) && !looksLikeUrl(name) && !/^(it|this|that|same|file)$/.test(name)) {
      return [{ type: "vscode.open", params: { folderDescriptor: name } }];
    }
  }

  // ------------------------------------------------------------- pronoun open
  // A typed noun after the pronoun ("open this video") is a typed-file request,
  // handled below; a bare pronoun ("open it") reopens the current item.
  const typedNounAfterPronoun = /\b(this|that)\s+(pdf|video|image|picture|photo|python|text|document|word|excel|spreadsheet|presentation|zip|audio|song|music|html|css|js|json|markdown|readme|file|folder)\b/.test(t);
  if (hasPronoun(t) && /^open|^go to/.test(t) && !typedNounAfterPronoun && !/\b(website|site|youtube|google)\b/.test(t)) {
    return [{ type: "os.open", params: { pronoun: "1" } }];
  }

  // Explicit internal MR00100 surfaces must never be mistaken for Windows.
  if (/\b(mr00100|internal|assistant)\b/.test(t)) {
    if (/\bterminal\b/.test(t)) return [{ type: "ui.panel", params: { panel: "terminal" } }];
    if (/\b(files?|explorer|file manager)\b/.test(t)) return [{ type: "ui.panel", params: { panel: "files" } }];
    if (/\bsettings?\b/.test(t)) return [{ type: "ui.panel", params: { panel: "settings" } }];
    if (/\b(security|firewall)\b/.test(t)) return [{ type: "ui.panel", params: { panel: "security" } }];
    if (/\b(memory)\b/.test(t)) return [{ type: "ui.panel", params: { panel: "memory" } }];
    if (/\bworkspace\b/.test(t) && /\b(open|access|go to)\b/.test(t)) {
      return [{ type: "os.folder", params: { descriptor: "workspace" } }];
    }
  }

  // -------------------------------------------- real terminal / consoles
  if (/\b(open|launch|start)\b/.test(t) && /\b(terminal|windows terminal|cmd|command prompt|powershell|pwsh)\b/.test(t)) {
    const app = /\bpowershell|pwsh\b/.test(t) ? "powershell" : /\b(cmd|command prompt)\b/.test(t) ? "cmd" : "terminal";
    return [{ type: "app.open", params: { app } }];
  }
  if (/\b(device manager|control panel|task manager|disk management|event viewer|services)\b/.test(t) && /\b(open|launch|start|show)\b/.test(t)) {
    const name = t.match(/\b(device manager|control panel|task manager|disk management|event viewer|services)\b/)![1];
    return [{ type: "app.open", params: { app: name } }];
  }
  if (/\b(installed apps|apps and features|apps & features|uninstall (a )?program|add or remove programs)\b/.test(t)) {
    return [{ type: "win.settings", params: { subject: "apps" } }];
  }

  // -------------------------------------------- navigation: go back / up
  if (/^\s*(go back|back|wapis|wapas|peeche|pichay|go up|up one level|parent folder)\s*$/.test(t)) {
    return [{ type: "fs.back", params: {} }];
  }

  // ------------------------------- typed / pronoun file targets
  // "open the PDF in D drive", "open this video", "open the python file"
  const typedFile = t.match(/\b(?:open|launch|play|show)\s+(?:the\s+|this\s+|that\s+|a\s+)?(pdf|video|image|picture|photo|python file|python|text file|text|document|word file|excel file|spreadsheet|presentation|zip|audio|song|music file|html file|css file|js file|json file|markdown|readme)\b/);
  if (typedFile && !/\bin (vs ?code|browser|chrome)\b/.test(t)) {
    const inDrive = t.match(/\bin\s+([a-z])\s*drive\b/);
    const inFolder = extractAbsolutePath(t)?.path ?? (inDrive ? `${inDrive[1].toUpperCase()}:\\` : "");
    return [{ type: "fs.open.typed", params: { kind: typedFile[1], folder: inFolder, contextual: /\b(this|that)\b/.test(t) ? "1" : "0" } }];
  }
  // "is file ko open karo" → normalized to "this file open" / "open this file"
  if (/\bthis (file|folder)\b/.test(t) && /\b(open|launch)\b/.test(t) && !filenameFrom(t)) {
    return [{ type: "os.open", params: { pronoun: "1" } }];
  }
  if (/\bthis (file|folder)\b/.test(t) && /\brename\b/.test(t)) {
    const to = t.match(/\b(?:to|as)\s+([\w.\-]+)/)?.[1] ?? "";
    return [{ type: "fs.rename", params: { contextual: "1", to } }];
  }
  if (/\bthis (file|folder)\b/.test(t) && /\bdelete\b/.test(t)) {
    return [{ type: "fs.delete", params: { contextual: "1" } }];
  }

  // ------------------------------------------ recycle bin restore
  if (/\brestore\b/.test(t) && /\b(file|folder|that|this|it|deleted|from recycle bin|recycle)\b/.test(t) && !/\bwindow\b/.test(t)) {
    const name = filenameFrom(t) ?? "";
    return [{ type: "win.recyclebin.restore", params: { name } }];
  }

  // ------------------------- contextual chain: "in this", "save", "browser"
  // "in this <folder> create X" → create relative to the active context.
  if (/\bin this\b/.test(t) && /\b(create|make|new)\b/.test(t) && /\bfolder\b/.test(t)) {
    const name = t
      .replace(/\b(in this|create|make|new|folder|a|an|the|please)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (name) return [{ type: "fs.mkdir", params: { path: name, scope: "context" } }];
  }
  if (/^\s*(save|save it|save this|save the file)\s*$/.test(t)) {
    return [{ type: "fs.save", params: { contextual: "1" } }];
  }
  if (/\b(open|launch)\b.*\bin browser\b/.test(t) || /^\s*in browser open\s*$/.test(t) || /\bbrowser\b.*\b(open|launch)\b/.test(t)) {
    if (!/\b(youtube|google|github|filecr|website|site|\.com|\.org|\.net)\b/.test(t)) {
      return [{ type: "browser.open.file", params: { contextual: "1" } }];
    }
  }

  // --------------------------------- window lifecycle (close/focus/etc.)
  if (isWindowListQuery(t)) return [{ type: "win.window.list", params: {} }];
  const windowIntent = parseWindowIntent(t);
  if (windowIntent) return windowIntent;

  // ------------------------------------------- Windows-specific intents
  const power = powerIntent(t);
  if (power) return power;

  const settings = windowsSettingsIntent(t);
  if (settings) return settings;

  if (/\b(recycle bin|trash|recyclebin)\b/.test(t)) {
    const empty = /\b(empty|clean|clear|delete|purge)\b/.test(t);
    return [{ type: empty ? "win.recyclebin.empty" : "win.recyclebin", params: {} }];
  }
  if (/\bstart menu\b/.test(t) || /\bstart ?up menu\b/.test(t)) {
    return [{ type: "win.startmenu", params: {} }];
  }
  if (/\bcontrol panel\b/.test(t)) {
    return [{ type: "win.controlpanel", params: {} }];
  }
  if (/\bwindows search\b/.test(t) || /^\s*search (files|programs) in windows\b/.test(t)) {
    const q = t.replace(/.*\bwindows search\b/, "").replace(/\b(for|in|search)\b/g, " ").trim();
    return [{ type: "win.search", params: { query: q } }];
  }
  const info = systemInfoIntent(t);
  if (info) return info;

  // ------------------------------------------------------- explorer/folders
  const folderWord = /\b(folder|directory)\b/.test(t);
  const openAccess = /\b(open|access|go to|navigate to|enter)\b/.test(t);

  if (/\b(file explorer|windows explorer)\b/.test(t) && openAccess) {
    const descriptor = abs ?? folderNameHint(t) ?? "";
    return [{ type: "os.explorer", params: { descriptor } }];
  }
  if (/^(open )?(downloads|download|desktop|documents|document|pictures|music|videos|home)( folder)?$/.test(t)) {
    const descriptor = (t.match(/\b(downloads|download|desktop|documents|document|pictures|music|videos|home)\b/)?.[1] ?? "desktop").replace(/\s*folder$/, "");
    return [{ type: "os.folder", params: { descriptor } }];
  }
  if (/\b(meri|my)\s+(files|downloads?|desktop|documents?)\b/.test(t)) {
    const descriptor = (t.match(/\b(downloads?|desktop|documents?|files)\b/)?.[1] ?? "home").replace(/s$/, "s");
    return [{ type: "os.folder", params: { descriptor: descriptor === "files" ? "home" : descriptor } }];
  }
  const drive = t.match(/^(?:open\s+|go to\s+)?([a-z])\s*drive\b/i);
  if (drive) {
    return [{ type: "os.folder", params: { descriptor: `${drive[1].toUpperCase()}:\\` } }];
  }
  if (folderWord && (openAccess || /^(?:go to|enter)/.test(t))) {
    const name = folderNameHint(t);
    if (name) return [{ type: "os.folder", params: { descriptor: name } }];
    if (abs) return [{ type: "os.folder", params: { descriptor: abs } }];
    return [{ type: "os.explorer", params: { descriptor: "" } }];
  }
  if (abs && /^(open|go to|of)|\b(explorer|folder|drive|directory)\b/.test(t)) {
    return [{ type: "os.open", params: { descriptor: abs } }];
  }
  if (abs) {
    return [{ type: "os.open", params: { descriptor: abs } }];
  }
  if (/^(open )?(explorer|files|my files|file manager)$/.test(t)) {
    return [{ type: "os.explorer", params: { descriptor: "" } }];
  }

  // ------------------------------------------------------------------ run
  if (/\b(npm run dev|npm start|npm test|npm run build)\b/.test(t)) {
    const command = t.match(/\b(npm run dev|npm start|npm test|npm run build)\b/)![1];
    return [{ type: "code.run", params: { command, kind: command.includes("test") ? "test" : "project" } }];
  }
  const runFile = t.match(/\b(?:run|execute|start)\s+(?:the\s+)?(?:file\s+)?([\w.\\/-]+\.(?:py|js|ts|go|php|c|cpp|java|rs))\b/i);
  if (runFile) {
    const scope = scopeFrom(t);
    return [{ type: "code.run", params: { path: runFile[1], scope: scope === "workspace" ? "vscode" : scope, kind: "file" } }];
  }
  if (/\b(run this|run it|run code|run program|run project|project run|test run|code run)\b/.test(t) || /^run(?: this| it)?$/.test(t)) {
    const kind = /\btest\b/.test(t) ? "test" : /\bproject\b/.test(t) ? "project" : "this";
    return [{ type: "code.run", params: { kind } }];
  }

  // ---------------------------------------------------------------- youtube
  const play = /\b(play|song|music|chalao)\b/.test(t) && !/\b(create|write|file|code|python|javascript)\b/.test(t);
  const yt = /\byoutube\b/.test(t) || play;
  if (yt && (/\b(play|search|song|music)\b/.test(t) || (/\byoutube\b/.test(t) && !/\bopen youtube\b/.test(t)))) {
    const q = youtubeQuery(t);
    if (/\bsearch\b/.test(t)) {
      return [{ type: "media.youtube.search", params: { query: q || "youtube" } }];
    }
    if (/\bplay\b/.test(t) || /\bsong\b/.test(t) || /\bmusic\b/.test(t)) {
      return [{ type: "media.youtube.play", params: { query: q || "music" } }];
    }
    if (q) {
      return [{ type: "media.youtube.search", params: { query: q } }];
    }
  }
  if (/^open youtube$/.test(t) || t === "youtube" || /^(open )?youtube$/.test(t)) {
    return [{ type: "media.youtube.open", params: {} }];
  }

  // ------------------------------------------------- host file operations
  const hostOp = fileOperationIntent(t, ctx);
  if (hostOp) return hostOp;

  // ----------------------------------------------------- destructive/delete
  if (/\b(delete|remove)\b/.test(t)) {
    const file = filenameFrom(t) ?? takeAfter(t, /\b(?:delete|remove)\s+(?:file|folder)?\s*(.+)$/);
    if (file) return [{ type: "fs.delete", params: { path: file.replace(/\b(file|folder)\b/g, "").trim(), scope: scopeFrom(t) } }];
  }
  if (/\brename\b/.test(t)) {
    const pair = t.match(/\brename\s+(\S+)\s+(?:to|as)\s+(\S+)/);
    if (pair) return [{ type: "fs.rename", params: { path: pair[1], to: pair[2], scope: scopeFrom(t) } }];
  }
  if (/\bcopy\b/.test(t) && /\b(file|folder)\b/.test(t)) {
    const pair = t.match(/\bcopy\s+(\S+)\s+(?:to)\s+(\S+)/);
    if (pair) return [{ type: "fs.copy", params: { path: pair[1], to: pair[2], scope: scopeFrom(t) } }];
  }
  if (/\bmove\b/.test(t) && /\b(file|folder)\b/.test(t)) {
    const pair = t.match(/\bmove\s+(\S+)\s+(?:to)\s+(\S+)/);
    if (pair) return [{ type: "fs.move", params: { path: pair[1], to: pair[2], scope: scopeFrom(t) } }];
  }
  if (/\b(create|make|new)\b/.test(t) && /\bfolder\b/.test(t)) {
    const name = filenameFrom(t) ?? takeAfter(t, /\bfolder\s+(.+)$/) ?? "new-folder";
    return [{ type: "fs.mkdir", params: { path: name, scope: scopeFrom(t) } }];
  }

  // --------------------------------------------------------------- websites
  if (/\b(open|launch|start|go to|visit|browse)\b/.test(t) && /\b(website|site|url)\b/.test(t)) {
    const rest = t.replace(/\b(open|launch|start|go to|navigate|visit|browse|website|site|url|this)\b/g, " ").replace(/\s+/g, " ").trim();
    if (rest && knownSite(rest)) return [{ type: "web.open", params: { site: rest } }];
    if (rest) return [{ type: "web.search", params: { query: rest } }];
    return [{ type: "web.open", params: { site: "google" } }];
  }

  const urlHit = t.match(/\b((?:https?:\/\/)?[\w-]+\.[\w.-]+(?:\/\S*)?)\b/);
  if (urlHit && /\b(open|go|visit|browse|launch)\b/.test(t)) {
    return [{ type: "web.open", params: { site: urlHit[1] } }];
  }

  // ----------------------------------------------------------------- search
  if (/\b(search|find|look up)\b/.test(t)) {
    const explicitGlobal = /\b(google|web|internet|browser|online)\b/.test(t);
    const q = searchQuery(t);
    if (q) {
      return [{ type: explicitGlobal ? "web.search" : "web.site.search", params: { query: q } }];
    }
  }

  // -------------------------------------------------------------------- open
  if (/\b(open|launch|start|visit|browse|go to)\b/.test(t)) {
    const rest = t
      .replace(/^\s*(open|launch|start|visit|browse|go to)\s+/i, "")
      .replace(/\s+(open|launch|start)$/i, "")
      .trim();
    const file = filenameFrom(t);
    if (file) {
      if (CODE_EXTS.has(fileExtOf(file)) || ctx.vscode) {
        return [{ type: "vscode.open", params: { path: file, scope: scopeFrom(t) } }];
      }
      return [{ type: "os.open", params: { descriptor: file } }];
    }
    if (!rest) return [{ type: "os.explorer", params: { descriptor: "" } }];
    if (/^(chat|terminal|files?|file manager|system|security|settings|memory|camera|history|developer|dev mode|mini mode|my project|the project|project)$/i.test(rest)) {
      return [];
    }
    if (rest === "browser") return [{ type: "app.open", params: { app: "chrome" } }];
    if (looksLikeUrl(rest) || knownSite(rest)) {
      return [{ type: "web.open", params: { site: rest } }];
    }
    const app = matchCatalog(rest);
    if (app?.id === "vscode") return [{ type: "vscode.open", params: {} }];
    if (app?.id === "explorer") return [{ type: "os.explorer", params: { descriptor: "" } }];
    if (app) return [{ type: "app.open", params: { app: app.id } }];
    if (knownSite(rest.split(" ")[0] ?? rest)) {
      return [{ type: "web.open", params: { site: rest } }];
    }
    // A bare name after "open" is most likely a real folder, not an app.
    if (/^[\w][\w .\-]{1,50}$/.test(rest) && !SPECIAL_FOLDERS.has(rest)) {
      return [{ type: "os.folder", params: { descriptor: rest } }];
    }
    return [{ type: "app.open", params: { app: rest } }];
  }

  if (/\b(close|quit|kill|terminate)\b/.test(t)) {
    const rest = t.replace(/^\s*(close|quit|kill|terminate)\s+/i, "").trim();
    if (rest) return [{ type: "app.close", params: { app: rest } }];
  }

  const appOnly = matchCatalog(t);
  if (appOnly?.id === "explorer" && t.split(" ").length <= 3) {
    return [{ type: "os.explorer", params: { descriptor: "" } }];
  }
  if (appOnly && t.split(" ").length <= 4) {
    return [{ type: "app.open", params: { app: appOnly.id } }];
  }
  if (knownSite(t) && t.split(" ").length <= 3) {
    return [{ type: "web.open", params: { site: t } }];
  }

  // ------------------------------------------------------ plain named folder
  const namedFolder = t.match(/^(?:open\s+)?([\w .\-]{2,60}?)(?:\s+(?:folder|directory))$/i);
  if (namedFolder && !SPECIAL_FOLDERS.has(namedFolder[1].trim())) {
    return [{ type: "os.folder", params: { descriptor: namedFolder[1].trim() } }];
  }

  return [];
}

function takeAfter(text: string, re: RegExp): string | undefined {
  const m = text.match(re);
  const value = m?.[1]?.trim();
  return value ? value : undefined;
}

export function parseDesktopPlan(raw: string): ParsedPlan | null {
  const { original, normalized, language } = normalizeCommand(raw);

  // Identity takes priority over everything — and must be checked before the
  // empty-normalization guard, since pure Urdu script normalizes to "".
  if (isIdentityQuestion(original) || isIdentityQuestion(normalized)) {
    return {
      language,
      original,
      normalized,
      actions: [{ type: "identity.answer", params: {} }],
      understanding: "IDENTITY.ANSWER",
      confidence: 0.99,
    };
  }

  if (!normalized) return null;

  const abs = extractAbsolutePath(normalized)?.path ?? extractAbsolutePath(original)?.path ?? null;

  const consolidatedCodeActions = codeCreationActions(normalized, original, abs);
  if (consolidatedCodeActions) {
    const understanding = consolidatedCodeActions.map((a) => a.type.toUpperCase()).join(" + ");
    return {
      language,
      original,
      normalized,
      actions: consolidatedCodeActions,
      understanding,
      confidence: 0.92,
    };
  }

  const vscode = wantsVsCode(normalized) || wantsVsCode(original.toLowerCase());
  const chunks = splitCompound(normalized);
  const actions: DesktopAction[] = [];
  for (const chunk of chunks) {
    const part = parseOne(chunk, { vscode }, abs);
    actions.push(...part);
  }

  // Nothing executable was recognised: fall back to current-information research.
  if (actions.length === 0) {
    const research = classifyResearch(original);
    if (research.isResearch) {
      return {
        language,
        original,
        normalized,
        actions: [{ type: "web.research", params: { query: research.query, category: research.category ?? "", reason: research.reason ?? "" } }],
        understanding: "WEB.RESEARCH",
        confidence: 0.75,
      };
    }
    return null;
  }

  // Compound context: after YouTube/web actions, a bare search continues in that site.
  const youtubeContext = wantsVsCode(normalized)
    ? false
    : actions.some(
        (a) =>
          a.type === "media.youtube.open" ||
          a.type === "media.youtube.search" ||
          a.type === "media.youtube.play" ||
          (a.type === "web.open" && a.params.site === "youtube"),
      );
  if (youtubeContext) {
    for (const a of actions) {
      if ((a.type === "web.search" || a.type === "web.site.search") && !/\bgoogle\b/.test(normalized)) {
        a.type = /\bplay\b/.test(normalized) ? "media.youtube.play" : "media.youtube.search";
      }
    }
  } else if (actions.some((a) => a.type === "web.open") && !/\b(google|internet|web)\b/.test(normalized)) {
    // Keep search in the website just opened in this task.
    for (const a of actions) {
      if (a.type === "web.search") a.type = "web.site.search";
    }
  }

  // Plan-level browser folding: one task uses one managed page.
  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    if (action.type !== "web.site.search") continue;
    const priorSite = actions.slice(0, i).reverse().find((candidate) => candidate.type === "web.open");
    if (priorSite?.params.site) action.params.site = priorSite.params.site;
  }
  const hasYouTubeFollowup = actions.some(
    (a) => a.type === "media.youtube.search" || a.type === "media.youtube.play",
  );
  const hasSiteFollowup = actions.some((a) => a.type === "web.site.search" && a.params.site);

  // Dedupe VS Code and fold intermediate browser opens into the final task.
  const meaningful = actions.filter((a, i) => {
    if (a.type === "vscode.open" && Object.keys(a.params).length === 0 && actions.some((b, j) => j !== i && b.type === "vscode.open" && Object.keys(b.params).length > 0)) return false;
    if (a.type === "media.youtube.open" && hasYouTubeFollowup) return false;
    if (a.type === "web.open" && hasSiteFollowup) return false;
    return true;
  });

  const understanding = meaningful.map((a) => a.type.toUpperCase()).join(" + ");

  return {
    language,
    original,
    normalized,
    actions: meaningful,
    understanding,
    confidence: 0.88,
  };
}
