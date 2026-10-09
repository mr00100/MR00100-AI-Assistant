export const IDENTITY_ANSWER = "ANS: I was developed BY MR00100.";

const IDENTITY_PATTERNS: RegExp[] = [
  /\bwho\s+(built|created|developed|made|designed|programmed|wrote)\s+(you|u|ur|this)\b/,
  /\bwho\s+(is|are)\s+(your\s+)?(creator|developer|creator|owner|author|maker|builder)\b/,
  /\bwho'?s\s+behind\s+you\b/,
  /\bwho\s+is\s+behind\s+you\b/,
  /\bwho\s+(built|created|developed|made)\s+mr00100\b/,
  /\b(creator|developer|author|owner|company)\s+(name|kya)\b/,
  /\bwhose\s+(brain|mind|code)\b/,
  /\btum(ko)?\s+(kis|kin|kisne)\b/,
  /\b(aap(ko)?|tumhe|tumko)\s+kis\s+ne\s+banaya\b/,
  /\bbanaya\s+(kisne|kaun)\b/,
  /\b kis\s+ne\s+banaya\b/,
  /\b( tum )?kis\s+ne\s+banaya\b/,
  /\bcreated\s+by\b/,
  /\bbuilt\s+by\b/,
  // Urdu script: "who made/created you", with or without the pronoun.
  /کس\s*نے\s*بنایا/,
  /کون\s*بنایا/,
  /تمہیں\s*کس/,
  /آپ\s*کو\s*کس/,
  /تمہارا\s*(خالق|بنانے\s*والا|ڈویلپر)/,
  /آپ\s*کا\s*(خالق|بنانے\s*والا|ڈویلپر)/,
];

const NON_IDENTITY_NOUNS = /\b(open|close|create|write|run|search|play|delete|install)\b/;

export function isIdentityQuestion(input: string): boolean {
  const text = input.trim();
  if (!text) return false;
  if (NON_IDENTITY_NOUNS.test(text) && !/who|creator|developer|banaya/i.test(text)) return false;
  if (/^\s*(who|creator|whose)\b/i.test(text)) return IDENTITY_PATTERNS.some((p) => p.test(text)) || /\bwho\b.*\byou\b/i.test(text);
  return IDENTITY_PATTERNS.some((p) => p.test(text));
}

/* -------------------------------------------------- current information */

const CURRENT_MARKERS =
  /\b(latest|today'?s?|today|current|currently|now|recent|recently|this week|this month|this year|breaking|breaking news|just now|as of now|update[ds]?|score[ds]?|scores|weather|price[ds]?|release[ds]?|live|right now|newest|upcoming|schedule|result[ds]?|standings|news|headline[sd]?|khabar|aj|abhi|naya|latest news)\b/i;

const YEAR_RE = /\b20\d{2}\b/;

const QUESTION_RE = /^(what|who|when|where|why|how|which|is|are|was|were|did|does|do|can|tell|explain|show|give|find|search)\b|[\?\?]\s*$/i;

const NON_CURRENT =
  /\b(implement|refactor|debug|fix this|my code|this file|rename|variable|function|syntax|compile error|stack trace)\b/i;

export type ResearchIntent = {
  isResearch: boolean;
  query: string;
  reason?: string;
  category?: string;
};

const CATEGORY_RULES: Array<[RegExp, string]> = [
  [/\b(cyber|hack|vulnerab|cve|exploit|penetration|malware|ransomware|phishing|ddos)\b/i, "cybersecurity"],
  [/\b(football|cricket|nba|nfl|uefa|champions league|soccer|tennis|formula ?1|f1|score|match|ipl|psl)\b/i, "sports"],
  [/\b(news|headline|world event|what happened|election|war|economy)\b/i, "news"],
  [/\b(program|programming|coding|developer|javascript|python|react|rust|golang|api|sdk|open source|github)\b/i, "programming"],
  [/\b(ai|artificial intelligence|machine learning|llm|neural|gpt|model)\b/i, "ai"],
  [/\b(tech|technology|gadget|smartphone|chip|quantum|space|semiconductor)\b/i, "technology"],
  [/\b(science|physics|biology|chemistry|research|paper|study material|study|notes|education|tutorial|course)\b/i, "science-education"],
  [/\b(music|song|album|release|film|movie|book|novel|game|gaming|art|design)\b/i, "culture"],
  [/\b(business|market|stock|crypto|bitcoin|economy|finance|trade)\b/i, "business"],
  [/\b(travel|tourism|hotel|flight|holiday|guide)\b/i, "travel"],
  [/\b(history|geography|polity|pakistan|india|world affairs)\b/i, "world"],
];

function categorize(query: string): string | undefined {
  for (const [re, label] of CATEGORY_RULES) if (re.test(query)) return label;
  return undefined;
}

export function classifyResearch(input: string): ResearchIntent {
  const query = input.trim();
  if (!query) return { isResearch: false, query };
  if (isIdentityQuestion(query)) return { isResearch: false, query, reason: "identity" };
  if (NON_CURRENT.test(query)) return { isResearch: false, query, reason: "local-code-task" };

  const hasCurrentMarker = CURRENT_MARKERS.test(query);
  const hasYear = YEAR_RE.test(query);
  const looksLikeQuestion = QUESTION_RE.test(query);
  const explicitFind = /\b(find|search|look ?up|google|research|latest)\b/i.test(query);

  if (!hasCurrentMarker && !hasYear && !(explicitFind && looksLikeQuestion)) {
    return { isResearch: false, query };
  }
  if (/\b(open|launch|start|play|download)\b/i.test(query) && !/search|find|latest|current/i.test(query)) {
    return { isResearch: false, query, reason: "action-command" };
  }

  return {
    isResearch: true,
    query,
    reason: hasCurrentMarker ? "current-information-marker" : hasYear ? "year-reference" : "explicit-research",
    category: categorize(query),
  };
}
