import {
  bridgeError,
  checkNavigationUrl,
  originOf,
  originPattern,
  sanitizePageUrl,
  urlWithoutQuery,
  type BridgeMethod,
  type ExtractParams,
  type ListTabsResult,
  type NavigateParams,
  type NavigateResult,
} from "@snapcrawl/shared";
import { installHistoryHook } from "../content/spa-hook.js";
import type { ContentResponse, TabGrant } from "../messages.js";
import { readGrants, writeGrants } from "./grants.js";

const UNREADABLE = ["chrome:", "chrome-extension:", "devtools:", "edge:", "about:", "file:", "view-source:"];

export async function handleMethod(method: BridgeMethod, params: unknown): Promise<ContentResponse> {
  switch (method) {
    case "listTabs":
      return { ok: true, result: await listTabs() };
    case "extract":
      return extract(isExtractParams(params) ? params : {});
    case "navigate":
      return navigate(isNavigateParams(params) ? params : null);
    default: {
      const unreachable: never = method;
      return { ok: false, error: bridgeError("CONTENT_SCRIPT_UNAVAILABLE", `Unknown method ${String(unreachable)}`) };
    }
  }
}

async function listTabs(): Promise<ListTabsResult> {
  const grants = await liveGrants();
  const tabs = await chrome.tabs.query({});
  const summaries = [];
  for (const grant of grants) {
    const tab = tabs.find((item) => item.id === grant.tabId);
    if (!tab?.url || !tab.id) continue;
    summaries.push({
      tabId: tab.id,
      title: tab.title ?? "",
      origin: grant.origin,
      urlWithoutQuery: urlWithoutQuery(tab.url),
      active: Boolean(tab.active),
      granted: true,
      allowNavigation: grant.allowNavigation,
      allowCrawl: grant.allowCrawl,
      allowDom: grant.allowDom,
    });
  }
  return { tabs: summaries };
}

async function extract(params: ExtractParams): Promise<ContentResponse> {
  const resolved = await resolveGrant(params.tabId);
  if (!resolved.ok) return resolved;
  if (params.detail === "dom" && !resolved.grant.allowDom) {
    return { ok: false, error: bridgeError("NOT_AUTHORIZED", "Sanitized DOM is off for this tab. Enable it in the popup.") };
  }
  const tab = resolved.tab;
  if (tab.id === undefined || !tab.url) {
    return { ok: false, error: bridgeError("CONTENT_SCRIPT_UNAVAILABLE", "This tab has no readable URL.") };
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: false },
      files: ["content.js"],
    });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: false },
      world: "MAIN",
      func: installHistoryHook,
    });
  } catch {
    return { ok: false, error: bridgeError("CONTENT_SCRIPT_UNAVAILABLE", "SnapCrawl cannot inject into this page.") };
  }
  try {
    const response = await chrome.tabs.sendMessage(tab.id, {
      target: "content",
      type: "extract",
      detail: params.detail,
      selector: params.selector,
      maxNodes: params.maxNodes,
      cursor: params.cursor,
    });
    if (!isContentResponse(response)) {
      return { ok: false, error: bridgeError("CONTENT_SCRIPT_UNAVAILABLE", "The page did not return a snapshot.") };
    }
    return response;
  } catch {
    return { ok: false, error: bridgeError("CONTENT_SCRIPT_UNAVAILABLE", "The page did not answer.") };
  }
}

async function navigate(params: NavigateParams | null): Promise<ContentResponse> {
  if (!params?.url) return { ok: false, error: bridgeError("UNSAFE_NAVIGATION", "A URL is required.") };
  const resolved = await resolveGrant(params.tabId);
  if (!resolved.ok) return resolved;
  if (!resolved.grant.allowNavigation) {
    return { ok: false, error: bridgeError("NOT_AUTHORIZED", "Navigation is off for this tab. Enable it in the popup.") };
  }
  const decision = checkNavigationUrl(params.url, resolved.grant.origin);
  if (!decision.ok) return { ok: false, error: bridgeError(decision.code, decision.message) };
  const tabId = resolved.tab.id;
  if (tabId === undefined) return { ok: false, error: bridgeError("TAB_CLOSED", "The tab is gone.") };
  try {
    await chrome.tabs.update(tabId, { url: decision.url });
  } catch {
    return { ok: false, error: bridgeError("UNSAFE_NAVIGATION", "Chrome refused to open that URL.") };
  }
  const status = await waitForComplete(tabId, decision.url, 8_000);
  const updated = await chrome.tabs.get(tabId).catch(() => null);
  const finalUrl = updated?.url ? sanitizePageUrl(updated.url) : decision.url;
  const origin = updated?.url ? originOf(updated.url) : resolved.grant.origin;
  if (origin !== resolved.grant.origin) {
    return { ok: false, error: bridgeError("ORIGIN_MISMATCH", "Navigation left the authorized origin.") };
  }
  const result: NavigateResult = { finalUrl, status };
  return { ok: true, result };
}

async function resolveGrant(tabId: number | undefined): Promise<{ ok: true; grant: TabGrant; tab: chrome.tabs.Tab } | ContentResponse & { ok: false }> {
  const grants = await liveGrants();
  const grant = tabId === undefined ? (grants.length === 1 ? grants[0] : undefined) : grants.find((item) => item.tabId === tabId);
  if (!grant) {
    const message = grants.length > 1 ? "tabId is required when more than one tab is authorized." : "Authorize a tab in the SnapCrawl popup.";
    return { ok: false, error: bridgeError("NOT_AUTHORIZED", message) };
  }
  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(grant.tabId);
  } catch {
    return { ok: false, error: bridgeError("TAB_CLOSED", "The authorized tab is closed.") };
  }
  if (!tab.url || !isReadableUrl(tab.url)) {
    return { ok: false, error: bridgeError("CONTENT_SCRIPT_UNAVAILABLE", "This page cannot be inspected.") };
  }
  const origin = originOf(tab.url);
  if (origin !== grant.origin) {
    return { ok: false, error: bridgeError("ORIGIN_MISMATCH", "The tab left the authorized origin.") };
  }
  const allowed = await chrome.permissions.contains({ origins: [originPattern(grant.origin)] });
  if (!allowed) return { ok: false, error: bridgeError("NOT_AUTHORIZED", "Host permission for this origin was revoked.") };
  return { ok: true, grant, tab };
}

async function liveGrants(): Promise<TabGrant[]> {
  const grants = await readGrants();
  const kept: TabGrant[] = [];
  for (const grant of grants) {
    try {
      const tab = await chrome.tabs.get(grant.tabId);
      const origin = tab.url ? originOf(tab.url) : null;
      if (origin === grant.origin) kept.push(grant);
    } catch {
      // Tab is gone.
    }
  }
  if (kept.length !== grants.length) await writeGrants(kept);
  return kept;
}

function waitForComplete(tabId: number, expectedUrl: string, timeoutMs: number): Promise<"complete" | "timeout"> {
  const expected = new URL(expectedUrl);
  const matches = (url: string | undefined) => {
    if (!url) return false;
    try {
      const current = new URL(url);
      return current.origin === expected.origin && current.pathname === expected.pathname;
    } catch {
      return false;
    }
  };
  return new Promise((resolve) => {
    let settled = false;
    const finish = (status: "complete" | "timeout") => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(status);
    };
    const timer = setTimeout(() => finish("timeout"), timeoutMs);
    const listener = (id: number, info: { status?: string }, tab: { url?: string }) => {
      if (id !== tabId || info.status !== "complete" || !matches(tab.url)) return;
      finish("complete");
    };
    chrome.tabs.onUpdated.addListener(listener);
    void chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === "complete" && matches(tab.url)) finish("complete");
    }).catch(() => undefined);
  });
}

export function isReadableUrl(value: string): boolean {
  return originOf(value) !== null && !UNREADABLE.some((prefix) => value.startsWith(prefix));
}

function isExtractParams(value: unknown): value is ExtractParams {
  return typeof value === "object" && value !== null;
}

function isNavigateParams(value: unknown): value is NavigateParams {
  if (typeof value !== "object" || value === null) return false;
  return typeof (value as { url?: unknown }).url === "string";
}

function isContentResponse(value: unknown): value is ContentResponse {
  if (typeof value !== "object" || value === null) return false;
  const record = value as { ok?: unknown };
  return typeof record.ok === "boolean";
}
