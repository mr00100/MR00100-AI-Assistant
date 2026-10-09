import { openInBrowser } from "./chrome";
import { browserTabManager } from "./tab-manager";

export type YouTubeResult = {
  ok: boolean;
  speak: string;
  detail?: string;
  reason?: string;
  action?: string;
  data?: Record<string, unknown>;
};

const YOUTUBE_HOME = "https://www.youtube.com";

export function youtubeSearchUrl(query: string): string {
  return `${YOUTUBE_HOME}/results?search_query=${encodeURIComponent(query)}`;
}

export async function openYouTube(): Promise<YouTubeResult> {
  const managed = await browserTabManager().navigate(YOUTUBE_HOME, "youtube-open");
  if (managed.ok) {
    return {
      ok: true,
      speak: "YouTube opened.",
      detail: managed.url,
      data: { url: managed.url, browser: "chrome", managed: true, reused: managed.reused, playback: "none" },
    };
  }
  const fallback = await openInBrowser(YOUTUBE_HOME);
  return {
    ok: fallback.ok,
    speak: fallback.ok ? "YouTube opened." : "I couldn't open YouTube.",
    detail: YOUTUBE_HOME,
    reason: fallback.reason ?? managed.reason,
    action: fallback.ok ? undefined : "Check that Chrome or another browser is installed.",
    data: { url: YOUTUBE_HOME, browser: fallback.browser, managed: false, playback: "none" },
  };
}

export async function searchYouTube(query: string): Promise<YouTubeResult> {
  const managed = await browserTabManager().searchYouTube(query);
  if (managed.ok) {
    return {
      ok: true,
      speak: `Searching YouTube for ${query}.`,
      detail: managed.url,
      data: { url: managed.url, browser: "chrome", managed: true, reused: managed.reused, playback: "none", query },
    };
  }
  const url = youtubeSearchUrl(query);
  const fallback = await openInBrowser(url);
  return {
    ok: fallback.ok,
    speak: fallback.ok ? `Searching YouTube for ${query}.` : "I couldn't open YouTube.",
    detail: url,
    reason: fallback.reason ?? managed.reason,
    action: fallback.ok ? undefined : "Check that a browser is installed.",
    data: { url, browser: fallback.browser, managed: false, playback: "none", query },
  };
}

/** Search, open the first real result, click/play the video, then verify video state. */
export async function playOnYouTube(query: string): Promise<YouTubeResult> {
  const managed = await browserTabManager().playYouTube(query);
  if (managed.ok) {
    const playing = managed.playback === "playing";
    return {
      ok: true,
      speak: playing
        ? `YouTube opened and ${query} is playing.`
        : `${query} is open in YouTube; playback was attempted but Chrome blocked autoplay.`,
      detail: managed.url,
      reason: managed.reason,
      action: managed.action,
      data: {
        url: managed.url,
        browser: "chrome",
        managed: true,
        reused: true,
        playback: managed.playback,
        query,
      },
    };
  }

  // Keep fallback one URL / one tab: search results only; never claim playback.
  const url = youtubeSearchUrl(query);
  const fallback = await openInBrowser(url);
  return {
    ok: fallback.ok,
    speak: fallback.ok
      ? `YouTube results for ${query} opened, but automated playback was unavailable.`
      : "I couldn't open YouTube.",
    detail: url,
    reason: managed.reason ?? fallback.reason,
    action: fallback.ok ? "Select the first result and press Play." : "Open Chrome manually and search YouTube.",
    data: { url, browser: fallback.browser, managed: false, playback: "blocked", query },
  };
}
