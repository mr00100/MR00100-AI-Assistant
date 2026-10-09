import { searchUrl } from "../browser/navigation";

export type ResearchSource = { title: string; url: string; snippet: string };
export type ResearchBundle = {
  ok: boolean;
  query: string;
  searchedAt: string;
  sources: ResearchSource[];
  context: string;
  reason?: string;
};

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 MR00100-AI/1.0";

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function stripTags(value: string): string {
  return decodeEntities(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function unwrapDuckUrl(url: string): string {
  const match = url.match(/uddg=([^&]+)/);
  if (!match) return url;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return url;
  }
}

/** Parse DuckDuckGo's HTML endpoint so answers can cite real sources. */
async function fetchDuckDuckGo(query: string): Promise<ResearchSource[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
      signal: controller.signal,
    });
    if (!response.ok) return [];
    const html = await response.text();
    const results: ResearchSource[] = [];
    const blockRe = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    let match: RegExpExecArray | null;
    while ((match = blockRe.exec(html)) && results.length < 6) {
      const url = unwrapDuckUrl(decodeEntities(match[1]));
      const title = stripTags(match[2]);
      const snippet = stripTags(match[3]);
      if (title && url.startsWith("http")) results.push({ title, url, snippet: snippet.slice(0, 400) });
    }
    return results;
  } finally {
    clearTimeout(timer);
  }
}

/** Fallback: the search-results page text, which still yields topical context. */
async function fetchGoogleContext(query: string): Promise<ResearchSource[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(searchUrl(query), {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
      signal: controller.signal,
    });
    if (!response.ok) return [];
    const html = await response.text();
    const text = stripTags(html);
    return [
      {
        title: `Google results for "${query}"`,
        url: searchUrl(query),
        snippet: text.slice(0, 1200),
      },
    ];
  } finally {
    clearTimeout(timer);
  }
}

export async function researchWeb(query: string, category = ""): Promise<ResearchBundle> {
  const trimmed = query.trim();
  if (!trimmed) {
    return { ok: false, query, searchedAt: new Date().toISOString(), sources: [], context: "", reason: "Empty research query." };
  }
  const searchQuery = category && category !== "news" ? `${trimmed}` : `${trimmed} news today`;

  let sources = await fetchDuckDuckGo(searchQuery).catch(() => [] as ResearchSource[]);
  if (!sources.length) {
    sources = await fetchDuckDuckGo(trimmed).catch(() => [] as ResearchSource[]);
  }
  if (!sources.length) {
    sources = await fetchGoogleContext(trimmed).catch(() => [] as ResearchSource[]);
  }
  if (!sources.length) {
    return {
      ok: false,
      query: trimmed,
      searchedAt: new Date().toISOString(),
      sources: [],
      context: "",
      reason: "No live web sources could be retrieved from this host.",
    };
  }

  const context = sources
    .map((s, i) => `[${i + 1}] ${s.title}\nURL: ${s.url}\n${s.snippet}`)
    .join("\n\n");

  return { ok: true, query: trimmed, searchedAt: new Date().toISOString(), sources, context: context.slice(0, 12000) };
}

/** Prompt used to summarise retrieved sources with attribution. */
export function researchPrompt(query: string, category: string, context: string): string {
  return [
    `Answer the user's question using ONLY the retrieved web sources below.`,
    `Question: ${query}`,
    category ? `Category: ${category}` : "",
    ``,
    `Retrieved at: ${new Date().toISOString()}`,
    ``,
    `WEB SOURCES:`,
    context,
    ``,
    `Rules:`,
    `- Summarise what the sources actually say.`,
    `- Cite sources inline as [1], [2] using the numbering above.`,
    `- State clearly if the sources do not answer the question.`,
    `- Never invent facts, dates, scores or events that are not in the sources.`,
    `- Keep the answer concise and useful.`,
  ]
    .filter(Boolean)
    .join("\n");
}
