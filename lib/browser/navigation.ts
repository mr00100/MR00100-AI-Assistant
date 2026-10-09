import { openWithOs } from "../windows/shell";

/** Direct mappings for well-known sites. Unknown names use a web search. */
const SITES: Record<string, string> = {
  youtube: "https://www.youtube.com",
  google: "https://www.google.com",
  facebook: "https://www.facebook.com",
  github: "https://github.com",
  microsoft: "https://www.microsoft.com",
  chatgpt: "https://chatgpt.com",
  openai: "https://chatgpt.com",
  gmail: "https://mail.google.com",
  instagram: "https://www.instagram.com",
  twitter: "https://x.com",
  x: "https://x.com",
  linkedin: "https://www.linkedin.com",
  reddit: "https://www.reddit.com",
  netflix: "https://www.netflix.com",
  amazon: "https://www.amazon.com",
  whatsapp: "https://web.whatsapp.com",
  filecr: "https://filecr.com",
  maps: "https://maps.google.com",
  translate: "https://translate.google.com",
  stackoverflow: "https://stackoverflow.com",
  npm: "https://www.npmjs.com",
  wikipedia: "https://wikipedia.org",
};

export function knownSite(name: string): string | null {
  const key = name.trim().toLowerCase().replace(/^www\./, "").replace(/\s+/g, "");
  if (SITES[key]) return SITES[key];
  const spaced = name.trim().toLowerCase();
  if (SITES[spaced]) return SITES[spaced];
  return null;
}

export function looksLikeUrl(value: string): boolean {
  return /^(https?:\/\/)/i.test(value) || /^[\w-]+\.[\w.-]+(\/.*)?$/i.test(value);
}

export function toUrl(value: string): string {
  if (/^https?:\/\//i.test(value)) return value;
  if (looksLikeUrl(value)) return `https://${value}`;
  const known = knownSite(value);
  if (known) return known;
  return searchUrl(`${value} official website`);
}

export function searchUrl(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

/** Best-effort "open the official site" without scraping (I'm Feeling Lucky / DDG bang). */
export function luckyUrl(query: string): string {
  return `https://duckduckgo.com/?q=${encodeURIComponent(`!ducky ${query} official website`)}`;
}

export function youtubeSearchUrl(query: string): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

export function youtubePlayUrl(query: string): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

export function openBrowser(url: string) {
  openWithOs(url);
  return url;
}

export function resolveWebsite(raw: string): { url: string; mode: "direct" | "search" | "lucky"; label: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { url: "https://www.google.com", mode: "direct", label: "Google" };
  }
  if (looksLikeUrl(trimmed) || /^https?:\/\//i.test(trimmed)) {
    const url = toUrl(trimmed);
    return { url, mode: "direct", label: new URL(url).hostname };
  }
  const known = knownSite(trimmed);
  if (known) return { url: known, mode: "direct", label: trimmed };
  return { url: luckyUrl(trimmed), mode: "lucky", label: trimmed };
}
