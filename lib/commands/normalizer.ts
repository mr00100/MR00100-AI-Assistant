import type { CommandLanguage } from "./types";

const WAKE = /^\s*(mr\s*0{2}\s*100|mr00100|mister 00100|mr one hundred|مسٹر)[\s,:-]*/i;

const URDU_WORDS: Array<[RegExp, string]> = [
  [/وی\s*ایس\s*کوڈ/g, " vscode "],
  [/فائل\s*ایکسپلورر/g, " file explorer "],
  [/ایکسپلورر/g, " explorer "],
  [/یوٹیوب/g, " youtube "],
  [/واٹس\s*ایپ|واٹس ایپ/g, " whatsapp "],
  [/اسپاٹيفائی|اسپاٹیفائی/g, " spotify "],
  [/کروم/g, " chrome "],
  [/گوگل/g, " google "],
  [/گٹ ہب|گٹہب/g, " github "],
  [/مائیکروسافٹ/g, " microsoft "],
  [/براؤزر|براوزر/g, " browser "],
  [/کیلکولیٹر/g, " calculator "],
  [/نوٹ پیڈ/g, " notepad "],
  [/پائتھون|پائتھن|پائیتھن/g, " python "],
  [/جاوا اسکرپٹ/g, " javascript "],
  [/ٹائپ اسکرپٹ/g, " typescript "],
  [/ڈاؤنلوڈز|ڈاؤنلوڈ/g, " downloads "],
  [/ڈیسک\s*ٹاپ|ڈیسک ٹاپ/g, " desktop "],
  [/دستاویزات/g, " documents "],
  [/فولڈر/g, " folder "],
  [/فائل/g, " file "],
  [/ویب سائٹ|ویبسایٹ/g, " website "],
  [/گانا|گیت/g, " song "],
  [/کوڈ/g, " code "],
  [/پروگرام/g, " program "],
  [/پروجیکٹ/g, " project "],
  [/ٹیسٹ/g, " test "],
  [/کیلکولیٹر/g, " calculator "],
  [/کھولو|کھولیں|کھول دو|کھول/g, " open "],
  [/چلاؤ|چلاو|چلا دو/g, " play "],
  [/بناؤ|بناو|بنا دو|بنائیں/g, " create "],
  [/لکھو|لکھیں|لکھ دو/g, " write "],
  [/حذف|ڈیلیٹ|مٹاؤ|ہٹاؤ|مٹا دو/g, " delete "],
  [/بند\s*(کرو|کر دو|کریں|کردو)/g, " close "],
  [/منیمائز|کم کرو/g, " minimize "],
  [/میکسیمائز|بڑا کرو/g, " maximize "],
  [/واپس جاؤ|پر جاؤ|فوکس/g, " focus "],
  [/ڈھونڈو|تلاش کرو/g, " search "],
  [/محفوظ کرو|سیو کرو/g, " save "],
  [/اس میں|اس فائل میں|اس فولڈر میں|اسمیں/g, " in this "],
  [/اس کو|اسے|یہ کو/g, " this "],
  [/یہ ونڈو|یہ ٹیب/g, " this window "],
  [/ڈرائیو/g, " drive "],
  [/ونڈو/g, " window "],
  [/ٹیب/g, " tab "],
  [/سیٹنگز|ترتیبات/g, " settings "],
  [/براؤزر میں/g, " in browser "],
  [/رن کرو|چلا کر/g, " run "],
  [/تلاش|سرچ/g, " search "],
  [/اور/g, " and "],
  [/پھر/g, " then "],
  [/میرے لیے|میرے ليے/g, " "],
  [/کو/g, " "],
  [/کی|کا|کے/g, " "],
  [/میں/g, " in "],
  [/پر/g, " on "],
  [/یہ/g, " this "],
];

const ROMAN_PHRASES: Array<[RegExp, string]> = [
  // ---- window lifecycle (must run before generic verb collapsing) -------
  [/\b(band|bnd)\s*(karo|kar do|kardo|kar|kr do|krdo|kr)\b/g, " close "],
  [/\bclose\s*(karo|kar do|kardo|kar|kr do|krdo|kr)\b/g, " close "],
  [/\bminimize\s*(karo|kar do|kardo|kr do|krdo|kr)\b/g, " minimize "],
  [/\bmaximize\s*(karo|kar do|kardo|kr do|krdo|kr)\b/g, " maximize "],
  [/\brestore\s*(karo|kar do|kardo|kr do|krdo|kr)\b/g, " restore "],
  [/\b(wapis|wapas)\s+(jao|chalo|le jao)\b/g, " focus "],
  [/\b(pe|par|pr)\s+(jao|chalo|wapis jao|wapas jao)\b/g, " focus "],
  [/\bfocus\s*(karo|kar do|kardo|kr)\b/g, " focus "],
  [/\bswitch\s*(karo|kar do|kardo|kr)\b/g, " focus "],
  [/\b(dhoondo|dhundho|dhundo|dhoondho|talash karo)\b/g, " search "],
  [/\bsearch\s*(karo|kar do|kardo|kro|kr do|krdo|kr)\b/g, " search "],
  [/\bfile\s*explorer\s+(kholo|kholein|khol do|open karo)\b/g, "open file explorer"],
  [/\b(vs\s*code|vscode)\s+(kholo|kholein|open karo|start karo)\b/g, "open vscode"],
  [/\b(google\s*)?chrome\s+(kholo|kholein|open karo|start karo)\b/g, "open chrome"],
  [/\byoutube\s+(kholo|kholein|open karo|chalao|chala do)\b/g, "open youtube"],
  [/\bwhatsapp\s+(kholo|open karo)\b/g, "open whatsapp"],
  [/\bspotify\s+(kholo|open karo|chalao)\b/g, "open spotify"],
  [/\bbrowser\s+(kholo|open karo)\b/g, "open browser"],
  [/\bgoogle\s+(kholo|open karo)\b/g, "open google"],
  [/\bgithub\s+(kholo|open karo)\b/g, "open github"],
  [/\bdownloads?\s+(kholo|open karo)\b/g, "open downloads"],
  [/\bdesktop\s+(kholo|open karo)\b/g, "open desktop"],
  [/\bdocuments?\s+(kholo|open karo)\b/g, "open documents"],
  [/\bmeri files?\s+(kholo|open karo)\b/g, "open file explorer"],
  [/\bcommand prompt\s+(kholo|open karo)\b/g, "open command prompt"],
  [/\bpowershell\s+(kholo|open karo)\b/g, "open powershell"],
  [/\bnotepad\s+(kholo|open karo)\b/g, "open notepad"],
  [/\bcalculator\s+(kholo|open karo)\b/g, "open calculator"],
  [/\b(gaana|gana|geet|song)s?\s+(chalao|chala do|play karo)\b/g, "play song"],
  [/\bplay karo\b/g, "play"],
  [/\bsearch karo\b/g, "search"],
  [/\bopen karo\b/g, "open"],
  [/\bstart karo\b/g, "start"],
  [/\brun karo\b/g, "run"],
  [/\bexecute karo\b/g, "run"],
  [/\bcreate karo\b/g, "create"],
  [/\bdelete karo\b/g, "delete"],
  [/\bclose karo\b/g, "close"],
  [/\bband karo\b/g, "close"],
  [/\bhatao\b/g, "delete"],
  [/\bmita(?:o| do)\b/g, "delete"],
  [/\bkhol\s*(do|dou|dein|den)\b/g, "open"],
  [/\bkholdo\b/g, "open"],
  [/\bkholo\b/g, "open"],
  [/\bkholein\b/g, "open"],
  [/\bkhol\b/g, "open"],
  [/\bopen\s*(kr do|krdo|kr|kro)\b/g, "open"],
  [/\bstart\s*(kr do|krdo|kr|kro)\b/g, "start"],
  [/\bbana\s*(do|dou|dein|den)\b/g, "create"],
  [/\bbnado\b|\bbanado\b/g, "create"],
  [/\bbna\b/g, "create"],
  [/\bcreate\s*(kr do|krdo|kr|kro)\b/g, "create"],
  [/\blikh\s*(do|dou|dein|den)\b/g, "write"],
  [/\blikhdo\b/g, "write"],
  [/\bwrite\s*(karo|kar do|kardo|kr do|krdo|kr|kro)\b/g, "write"],
  [/\bsave\s*(karo|kar do|kardo|kr do|krdo|kr|kro)\b/g, "save"],
  [/\brun\s*(kr do|krdo|kr|kro)\b/g, "run"],
  [/\bchala\s*(do|dein)\b/g, "run"],
  [/\brename\s*(karo|kar do|kardo|kr do|krdo|kr|kro)\b/g, "rename"],
  [/\bdelete\s*(karo|kar do|kardo|kr do|krdo|kr|kro)\b/g, "delete"],
  [/\bcopy\s*(karo|kar do|kardo|kr do|krdo|kr|kro)\b/g, "copy"],
  [/\bmove\s*(karo|kar do|kardo|kr do|krdo|kr|kro)\b/g, "move"],
  [/\bbatao\b|\bbtao\b|\bbata do\b/g, " tell "],
  [/\bmujhe\b|\bmujhy\b/g, " "],
  [/\b(aj|aaj)\b/g, " today "],
  [/\bkya hai\b|\bkia hai\b/g, " "],
  [/\bweather\b/g, "weather"],
  [/\bchalao\b/g, "play"],
  [/\bchala do\b/g, "play"],
  [/\bbanao\b/g, "create"],
  [/\bbana do\b/g, "create"],
  [/\blikho\b/g, "write"],
  [/\bgaana\b/g, "song"],
  [/\bgana\b/g, "song"],
  [/\bgeet\b/g, "song"],
  [/\bwebsite\b/g, "website"],
  // Pronouns → canonical "this" so the context resolver can act on them.
  [/\b(isme|is mein|ismein|is me|usme|us mein|usmein)\b/g, " in this "],
  [/\b(isko|isay|ise|iskko|issko|usko|usay|use ko)\b/g, " this "],
  [/\b(yeh|yah|ye|iss|is)\s+(window|tab|file|folder|page|app)\s+ko\b/g, " this $2 "],
  [/\b(yeh|yah|ye|iss|is)\s+(window|tab|file|folder|page|app)\b/g, " this $2 "],
  [/\bjo abhi (khola|kholi|khola tha|open kiya|kiya) (tha|thi)?\b/g, " this "],
  [/\bjo abhi (banaya|banai|bnaya) (tha|thi)?\b/g, " this "],
  [/\b(yahan|yahaan)\b/g, " here "],
  [/\b(wahan|wahaan)\b/g, " there "],
  [/\b(yar|yaar|acha|accha|theek hai|thik hai|zara|zra|bhai)\b/g, " "],
  [/\bmere liye\b/g, " "],
  [/\bplease\b/g, " "],
  [/\bkindly\b/g, " "],
  [/\bcan you\b/g, " "],
  [/\bcould you\b/g, " "],
  [/\bwould you\b/g, " "],
  [/\bkar ke\b/g, " and "],
  [/\bkarke\b/g, " and "],
  [/\baur\b/g, " and "],
  [/\bphir\b/g, " then "],
  [/\bmein\b/g, " in "],
  [/\bpar\b/g, " on "],
  [/\bpe\b/g, " on "],
  [/\bki\b/g, " "],
  [/\bka\b/g, " "],
  [/\bke\b/g, " "],
  [/\bko\b/g, " "],
  [/\bye\b/g, " this "],
];

const ROMAN_HINT = /\b(kholo|kholein|karo|banao|chalao|likho|hatao|gaana|gana|aur|mein|mere liye|karke)\b/i;
const URDU_HINT = /[\u0600-\u06FF]/;

/**
 * Strip the wake word only when it is genuinely an address, not part of a
 * real name. "MR00100, open chrome" → strips. "open MR00100 Ai folder" and
 * "MR00100 Ai folder kholo" keep the name, because the user's real folder is
 * literally called "MR00100 Ai".
 */
export function stripWakeWord(input: string): string {
  const match = WAKE.exec(input);
  if (!match) return input.trim();

  const separator = match[0].slice(match[1].length);
  const rest = input.slice(match[0].length).trim();
  if (!rest) return input.trim();

  // An explicit separator ("MR00100, ...") is always an address.
  if (/[,:\-]/.test(separator)) return rest;

  // Otherwise only strip when the remainder begins like a command.
  const startsWithVerb =
    /^(open|launch|start|close|quit|exit|minimi[sz]e|maximi[sz]e|restore|focus|switch|create|make|new|write|save|run|execute|play|search|find|delete|remove|rename|copy|move|edit|show|list|go|bring|kholo|khol|banao|likho|chalao|band|karo|kar)\b/i.test(
      rest,
    );
  return startsWithVerb ? rest : input.trim();
}

export function detectLanguage(input: string): CommandLanguage {
  const ur = URDU_HINT.test(input);
  const roman = ROMAN_HINT.test(input);
  const latin = /[a-z]/i.test(input);
  if (ur && (roman || latin)) return "mixed";
  if (ur) return "ur";
  if (roman && latin) return "mixed";
  if (roman) return "roman";
  return "en";
}

export function normalizeCommand(raw: string): { original: string; normalized: string; language: CommandLanguage } {
  const original = stripWakeWord(raw).trim();
  const language = detectLanguage(original);
  let text = original;

  for (const [re, to] of URDU_WORDS) text = text.replace(re, to);
  text = text.replace(/[\u0600-\u06FF]+/g, " ");
  text = text.toLowerCase();
  for (const [re, to] of ROMAN_PHRASES) text = text.replace(re, to);

  text = text
    .replace(/[?!]+/g, " ")
    // Sentence-ending punctuation must not glue onto the last word ("settings.").
    .replace(/[.,;:]+(\s|$)/g, " ")
    .replace(/\b(the|a|an|please|now|for me)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return { original, normalized: text, language };
}

export function splitCompound(normalized: string): string[] {
  const parts = normalized.split(/\s+(?:and|then)\s+/);
  if (parts.length === 1) return [normalized];
  const verb = /\b(open|launch|start|play|search|run|delete|close|access)\b/;
  const actionable = parts.filter((p) => p.trim().length > 1);
  if (actionable.length >= 2 && actionable.filter((p) => verb.test(p)).length >= 2) {
    return actionable.map((p) => p.trim()).filter(Boolean);
  }
  return [normalized];
}
