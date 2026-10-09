import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { BrowserContext, Page } from "playwright-core";
import { chromium } from "playwright-core";
import { findChrome } from "./chrome";

export type BrowserTaskState = {
  browser: "chrome";
  url: string;
  domain: string;
  title: string;
  intent: string;
  query?: string;
  managed: boolean;
  updatedAt: number;
};

export type ManagedBrowserResult = {
  ok: boolean;
  url?: string;
  domain?: string;
  title?: string;
  reason?: string;
  action?: string;
  playback?: "playing" | "attempted" | "blocked" | "none";
  query?: string;
  reused?: boolean;
};

type BrowserManagerGlobal = typeof globalThis & {
  __mr00100BrowserManager?: BrowserTabManager;
};

function profileDir(): string {
  if (process.platform === "win32") {
    const base = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    return path.join(base, "MR00100", "ChromeAutomationProfile");
  }
  return path.join(os.homedir(), ".mr00100", "chrome-automation-profile");
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function sameSite(a: string, b: string): boolean {
  const aa = hostname(a);
  const bb = hostname(b);
  return aa === bb || aa.endsWith(`.${bb}`) || bb.endsWith(`.${aa}`);
}

export class BrowserTabManager {
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private starting: Promise<Page> | null = null;
  private state: BrowserTaskState | null = null;

  get task(): BrowserTaskState | null {
    return this.state;
  }

  private async ensurePage(): Promise<Page> {
    if (this.page && !this.page.isClosed()) return this.page;
    if (this.starting) return this.starting;

    this.starting = (async () => {
      const executablePath = await findChrome();
      if (!executablePath) throw new Error("Google Chrome was not found on PATH or in standard installation locations.");
      const userDataDir = profileDir();
      await fs.mkdir(userDataDir, { recursive: true });

      try {
        this.context = await chromium.launchPersistentContext(userDataDir, {
          executablePath,
          headless: false,
          viewport: null,
          args: [
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-background-mode",
            "--disable-session-crashed-bubble",
            "--autoplay-policy=no-user-gesture-required",
          ],
        });
      } catch (error) {
        this.context = null;
        throw new Error(`Chrome automation could not start: ${error instanceof Error ? error.message : "unknown error"}`);
      }

      const pages = this.context.pages();
      this.page = pages[0] ?? (await this.context.newPage());
      // Close only extra pages created in MR00100's dedicated automation profile.
      for (const extra of pages.slice(1)) await extra.close().catch(() => null);
      this.context.on("close", () => {
        this.context = null;
        this.page = null;
        this.state = null;
      });
      this.page.on("close", () => {
        this.page = null;
      });
      return this.page;
    })();

    try {
      return await this.starting;
    } finally {
      this.starting = null;
    }
  }

  private async update(intent: string, query?: string) {
    if (!this.page || this.page.isClosed()) return;
    const url = this.page.url();
    this.state = {
      browser: "chrome",
      url,
      domain: hostname(url),
      title: await this.page.title().catch(() => ""),
      intent,
      query,
      managed: true,
      updatedAt: Date.now(),
    };
  }

  async navigate(url: string, intent = "navigate"): Promise<ManagedBrowserResult> {
    try {
      const page = await this.ensurePage();
      const reused = Boolean(this.state);
      await page.bringToFront();
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      const current = page.url();
      if (!sameSite(current, url)) {
        return {
          ok: false,
          url: current,
          domain: hostname(current),
          reason: `Chrome navigated to ${current}, not the requested site ${url}.`,
          action: "Check connectivity or the website address.",
          reused,
        };
      }
      await this.update(intent);
      return { ok: true, url: current, domain: hostname(current), title: this.state?.title, reused };
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : "Chrome navigation failed.",
        action: "MR00100 will fall back to the system browser when possible.",
      };
    }
  }

  async searchCurrent(query: string): Promise<ManagedBrowserResult> {
    if (!query.trim()) return { ok: false, reason: "Search query was empty.", action: "Say what to search for." };
    try {
      const page = await this.ensurePage();
      await page.bringToFront();
      const currentUrl = page.url();
      const domain = hostname(currentUrl);
      if (!domain || currentUrl === "about:blank") {
        return { ok: false, reason: "There is no active website to search.", action: "Open a website first, then search it." };
      }

      const direct = siteSearchUrl(domain, query);
      if (direct) {
        await page.goto(direct, { waitUntil: "domcontentloaded", timeout: 30_000 });
      } else {
        const selector = await firstVisible(page, [
          'input[type="search"]',
          'input[name="s"]',
          'input[name="q"]',
          'input[role="searchbox"]',
          'input[placeholder*="Search" i]',
          'input[aria-label*="Search" i]',
        ]);
        if (selector) {
          await page.locator(selector).first().fill(query);
          await page.locator(selector).first().press("Enter");
          await page.waitForLoadState("domcontentloaded", { timeout: 20_000 }).catch(() => null);
        } else {
          const fallback = `${new URL(currentUrl).origin}/search?q=${encodeURIComponent(query)}`;
          await page.goto(fallback, { waitUntil: "domcontentloaded", timeout: 30_000 });
        }
      }

      const resultUrl = page.url();
      if (!sameSite(resultUrl, currentUrl)) {
        return {
          ok: false,
          url: resultUrl,
          domain: hostname(resultUrl),
          reason: `The site search navigated outside ${domain}.`,
          action: "The site's search may use an external provider; review the page manually.",
        };
      }
      await this.update("site-search", query);
      return { ok: true, url: resultUrl, domain, title: this.state?.title, reused: true, playback: "none" };
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : "Website search failed.",
        action: "The website may have changed its search interface. Search manually in the open tab.",
      };
    }
  }

  async searchYouTube(query: string): Promise<ManagedBrowserResult> {
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    const result = await this.navigate(url, "youtube-search");
    if (result.ok) await this.update("youtube-search", query);
    return { ...result, playback: "none" };
  }

  async playYouTube(query: string): Promise<ManagedBrowserResult> {
    try {
      const page = await this.ensurePage();
      await page.bringToFront();
      const search = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAQ%253D%253D`;
      await page.goto(search, { waitUntil: "domcontentloaded", timeout: 30_000 });
      const firstVideo = page.locator('ytd-video-renderer a#thumbnail, ytd-rich-item-renderer a#thumbnail').first();
      await firstVideo.waitFor({ state: "visible", timeout: 20_000 });
      await firstVideo.click();
      await page.waitForURL(/youtube\.com\/watch\?v=/, { timeout: 25_000 });
      await page.waitForSelector("video", { state: "attached", timeout: 20_000 });

      let playing = await page.evaluate(() => {
        const video = document.querySelector("video");
        if (!video) return false;
        void video.play().catch(() => null);
        return !video.paused;
      });
      if (!playing) {
        const playButton = page.locator('.ytp-play-button[aria-label*="Play" i]').first();
        if (await playButton.isVisible().catch(() => false)) await playButton.click().catch(() => null);
        await page.waitForTimeout(600);
        playing = await page.evaluate(() => {
          const video = document.querySelector("video");
          return Boolean(video && !video.paused && video.readyState >= 2);
        });
      }

      await this.update("youtube-play", query);
      return {
        ok: true,
        url: page.url(),
        domain: "youtube.com",
        title: this.state?.title,
        query,
        reused: true,
        playback: playing ? "playing" : "attempted",
        reason: playing ? undefined : "Chrome or YouTube blocked unattended autoplay.",
        action: playing ? undefined : "The video is open in the same tab; press the visible Play button.",
      } as ManagedBrowserResult;
    } catch (error) {
      return {
        ok: false,
        playback: "blocked",
        reason: error instanceof Error ? error.message : "YouTube playback automation failed.",
        action: "YouTube search remains available; select a result manually if the page layout changed.",
      };
    }
  }

  /** True when MR00100 currently drives a live Chrome page. */
  hasLivePage(): boolean {
    return Boolean(this.page && !this.page.isClosed());
  }

  /**
   * Close the managed tab (or a specific site's tab) without terminating the
   * whole browser. Returns what was actually closed.
   */
  async closeTab(options: { site?: string; all?: boolean } = {}): Promise<ManagedBrowserResult> {
    if (!this.context) {
      return { ok: false, reason: "MR00100 has no managed Chrome tab open.", action: "Open a website through MR00100 first." };
    }
    const pages = this.context.pages().filter((p) => !p.isClosed());
    if (!pages.length) {
      return { ok: false, reason: "There is no open managed Chrome tab.", action: "Open a website first." };
    }

    let targets = pages;
    if (options.site) {
      const needle = options.site.toLowerCase();
      const matched = pages.filter((p) => hostname(p.url()).includes(needle));
      if (!matched.length) {
        return { ok: false, reason: `No managed Chrome tab is showing ${options.site}.`, action: "Check which site is open." };
      }
      targets = matched;
    } else if (!options.all) {
      targets = [this.page && !this.page.isClosed() ? this.page : pages[pages.length - 1]];
    }

    const closedUrls: string[] = [];
    for (const target of targets) {
      closedUrls.push(target.url());
      await target.close().catch(() => null);
    }

    const remaining = this.context.pages().filter((p) => !p.isClosed());
    this.page = remaining[0] ?? null;
    if (!this.page) this.state = null;
    else await this.update(this.state?.intent ?? "active", this.state?.query);

    return {
      ok: closedUrls.length > 0,
      url: closedUrls[0],
      domain: hostname(closedUrls[0] ?? ""),
      reused: true,
      reason: closedUrls.length ? undefined : "No tab was closed.",
    };
  }

  /** Close the managed Chrome window/context entirely. */
  async closeWindow(): Promise<ManagedBrowserResult> {
    if (!this.context) {
      return { ok: false, reason: "MR00100 does not have a managed Chrome window open.", action: "Use `close chrome` to close a manually opened Chrome." };
    }
    const lastUrl = this.page && !this.page.isClosed() ? this.page.url() : undefined;
    await this.context.close().catch(() => null);
    this.context = null;
    this.page = null;
    this.state = null;
    return { ok: true, url: lastUrl, domain: hostname(lastUrl ?? "") };
  }

  async status(): Promise<BrowserTaskState | null> {
    if (!this.page || this.page.isClosed()) return null;
    await this.update(this.state?.intent ?? "active", this.state?.query);
    return this.state;
  }
}

async function firstVisible(page: Page, selectors: string[]): Promise<string | null> {
  for (const selector of selectors) {
    try {
      const locator = page.locator(selector).first();
      if (await locator.isVisible({ timeout: 800 })) return selector;
    } catch {
      /* try next selector */
    }
  }
  return null;
}

export function siteSearchUrl(domain: string, query: string): string | null {
  if (domain.endsWith("youtube.com")) return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  if (domain.endsWith("github.com")) return `https://github.com/search?q=${encodeURIComponent(query)}&type=repositories`;
  if (domain.endsWith("filecr.com")) return `https://filecr.com/?s=${encodeURIComponent(query)}`;
  if (domain.endsWith("reddit.com")) return `https://www.reddit.com/search/?q=${encodeURIComponent(query)}`;
  if (domain.endsWith("google.com")) return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  if (domain.endsWith("wikipedia.org")) return `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(query)}`;
  if (domain.endsWith("npmjs.com")) return `https://www.npmjs.com/search?q=${encodeURIComponent(query)}`;
  return null;
}

export function browserTabManager(): BrowserTabManager {
  const g = globalThis as BrowserManagerGlobal;
  g.__mr00100BrowserManager ??= new BrowserTabManager();
  return g.__mr00100BrowserManager;
}
