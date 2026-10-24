import { randomUUID } from "node:crypto";
import {
  LIMITS,
  canonicalUrl,
  checkNavigationUrl,
  clamp,
  type CrawlWebsiteResult,
  type LinkInfo,
  type ListTabsResult,
  type NavigationGraph,
  type NavigateResult,
  type PageSnapshot,
  type TabSummary,
} from "@snapcrawl/shared";
import { BridgeFailure, type Bridge } from "../bridge/types.js";

export class CrawlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CrawlError";
  }
}

export type Clock = {
  now(): number;
  sleep(ms: number): Promise<void>;
};

type QueueItem = {
  url: string;
  canonical: string;
  depth: number;
  from: string;
  label: string;
};

type CrawlState = {
  id: string;
  origin: string;
  tabId: number;
  maxPages: number;
  maxDepth: number;
  createdAt: number;
  pagesSeen: number;
  visited: Set<string>;
  queue: QueueItem[];
  nodes: NavigationGraph["nodes"];
  edges: NavigationGraph["edges"];
};

const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export class CrawlEngine {
  private readonly crawls = new Map<string, CrawlState>();
  private readonly cancelled = new Set<string>();
  private lastNavAt = 0;

  constructor(
    private readonly bridge: Bridge,
    private readonly clock: Clock = realClock,
  ) {
    bridge.onCancel((crawlId) => this.cancel(crawlId));
  }

  cancel(crawlId?: string): void {
    if (crawlId) {
      this.cancelled.add(crawlId);
      return;
    }
    for (const id of this.crawls.keys()) this.cancelled.add(id);
  }

  async crawlWebsite(input: { tabId?: number; crawlId?: string; maxPages?: number; maxDepth?: number }): Promise<CrawlWebsiteResult> {
    this.dropExpired();
    if (!input.crawlId) return this.start(input);
    const state = this.crawls.get(input.crawlId);
    if (!state) throw new CrawlError("Unknown crawl. Call crawl_website first.");
    if (this.cancelled.has(state.id)) throw new BridgeFailure("CANCELLED", "The crawl was stopped.");
    if (state.queue.length === 0 || state.pagesSeen >= state.maxPages) {
      return { crawlId: state.id, page: null, queueRemaining: 0, done: true };
    }
    const next = state.queue.shift();
    if (!next) return { crawlId: state.id, page: null, queueRemaining: 0, done: true };
    state.visited.add(next.canonical);
    await this.pace();
    await this.bridge.request("navigate", { tabId: state.tabId, url: next.url }, LIMITS.navigateTimeoutMs);
    this.lastNavAt = this.clock.now();
    await this.clock.sleep(LIMITS.settleMs);
    const page = await this.snapshot(state.tabId);
    this.record(state, page, next.depth, next);
    return this.view(state, page);
  }

  graph(crawlId: string): NavigationGraph {
    const state = this.crawls.get(crawlId);
    if (!state) throw new CrawlError("Unknown crawl. Call crawl_website first.");
    return { nodes: state.nodes, edges: state.edges };
  }

  private async start(input: { tabId?: number; maxPages?: number; maxDepth?: number }): Promise<CrawlWebsiteResult> {
    const tab = await this.requireTab(input.tabId, "allowCrawl");
    const page = await this.snapshot(tab.tabId);
    const state: CrawlState = {
      id: randomUUID(),
      origin: tab.origin,
      tabId: tab.tabId,
      maxPages: clamp(input.maxPages ?? LIMITS.maxPagesDefault, 1, LIMITS.maxPagesHard),
      maxDepth: clamp(input.maxDepth ?? LIMITS.maxDepthDefault, 0, LIMITS.maxDepthHard),
      createdAt: this.clock.now(),
      pagesSeen: 0,
      visited: new Set(),
      queue: [],
      nodes: [],
      edges: [],
    };
    this.crawls.set(state.id, state);
    this.record(state, page, 0);
    return this.view(state, page);
  }

  private record(state: CrawlState, page: PageSnapshot, depth: number, via?: QueueItem): void {
    const canonical = canonicalUrl(page.url);
    state.visited.add(canonical);
    state.pagesSeen += 1;
    state.nodes.push({ url: canonical, title: page.title, depth });
    if (via) state.edges.push({ from: via.from, to: canonical, label: via.label });
    if (depth >= state.maxDepth) return;
    for (const link of linksOf(page)) {
      if (!link.sameOrigin) continue;
      const decision = checkNavigationUrl(link.href, state.origin);
      if (!decision.ok) continue;
      const next = canonicalUrl(decision.url);
      if (state.visited.has(next) || state.queue.some((item) => item.canonical === next)) continue;
      state.queue.push({ url: decision.url, canonical: next, depth: depth + 1, from: canonical, label: link.text });
    }
  }

  private view(state: CrawlState, page: PageSnapshot): CrawlWebsiteResult {
    const done = state.queue.length === 0 || state.pagesSeen >= state.maxPages;
    if (done) state.queue = [];
    return { crawlId: state.id, page, queueRemaining: state.queue.length, done };
  }

  private async pace(): Promise<void> {
    if (this.lastNavAt === 0) return;
    const wait = LIMITS.navigateIntervalMs - (this.clock.now() - this.lastNavAt);
    if (wait <= 0) return;
    if (wait > 10_000) throw new BridgeFailure("RATE_LIMITED", "Navigation is happening too often.");
    await this.clock.sleep(wait);
  }

  private async snapshot(tabId: number): Promise<PageSnapshot> {
    const result = await this.bridge.request("extract", { tabId, detail: "full" }, LIMITS.toolTimeoutMs);
    if (!isSnapshot(result)) throw new BridgeFailure("CONTENT_SCRIPT_UNAVAILABLE", "The browser returned an unexpected page snapshot.");
    return result;
  }

  private async requireTab(tabId: number | undefined, flag: "allowNavigation" | "allowCrawl" | "allowDom"): Promise<TabSummary> {
    const listed = await this.bridge.request("listTabs", {}, LIMITS.listTabsTimeoutMs);
    if (!isTabList(listed)) throw new BridgeFailure("CONTENT_SCRIPT_UNAVAILABLE", "The browser returned an unexpected tab list.");
    const tab = tabId === undefined ? (listed.tabs.length === 1 ? listed.tabs[0] : undefined) : listed.tabs.find((item) => item.tabId === tabId);
    if (!tab) {
      throw new BridgeFailure(
        "NOT_AUTHORIZED",
        listed.tabs.length > 1 ? "tabId is required when more than one tab is authorized." : "Authorize a tab in the SnapCrawl popup.",
      );
    }
    if (!tab[flag]) throw new BridgeFailure("NOT_AUTHORIZED", "That action is turned off for this tab.");
    return tab;
  }

  private dropExpired(): void {
    for (const [id, state] of this.crawls) {
      if (this.clock.now() - state.createdAt > LIMITS.crawlTtlMs) this.crawls.delete(id);
    }
  }
}

function linksOf(page: PageSnapshot): LinkInfo[] {
  if (page.interactive?.links) return page.interactive.links;
  return page.linksInternal.map((link) => ({
    text: link.text,
    href: new URL(link.path, page.origin).toString(),
    path: link.path,
    sameOrigin: true,
  }));
}

function isSnapshot(value: unknown): value is PageSnapshot {
  if (typeof value !== "object" || value === null) return false;
  const record = value as { url?: unknown; title?: unknown; origin?: unknown };
  return typeof record.url === "string" && typeof record.title === "string" && typeof record.origin === "string";
}

function isTabList(value: unknown): value is ListTabsResult {
  if (typeof value !== "object" || value === null) return false;
  return Array.isArray((value as { tabs?: unknown }).tabs);
}

export function isNavigateResult(value: unknown): value is NavigateResult {
  if (typeof value !== "object" || value === null) return false;
  const record = value as { finalUrl?: unknown; status?: unknown };
  return typeof record.finalUrl === "string" && (record.status === "complete" || record.status === "timeout");
}
