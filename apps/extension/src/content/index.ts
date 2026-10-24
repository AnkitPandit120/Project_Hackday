import { extractDocument, ExtractError } from "./extract.js";

const FLAG = "__snapcrawlContent";
const scope = globalThis as typeof globalThis & { [FLAG]?: boolean; __snapcrawlLastNav?: number };

if (!scope[FLAG]) {
  scope[FLAG] = true;
  scope.__snapcrawlLastNav = 0;
  window.addEventListener("snapcrawl:navigation", () => {
    scope.__snapcrawlLastNav = Date.now();
  });
  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (!isExtract(message)) return;
    try {
      const lastNav = scope.__snapcrawlLastNav ?? 0;
      const snapshot = extractDocument(document, {
        pageUrl: window.location.href,
        detail: message.detail,
        selector: message.selector,
        maxNodes: message.maxNodes,
        cursor: message.cursor,
        settled: lastNav === 0 || Date.now() - lastNav > 500,
      });
      sendResponse({ ok: true, result: snapshot });
    } catch (error) {
      if (error instanceof ExtractError) {
        sendResponse({ ok: false, error: { code: error.code, message: error.message } });
      } else {
        sendResponse({ ok: false, error: { code: "CONTENT_SCRIPT_UNAVAILABLE", message: "Could not read this page." } });
      }
    }
    return true;
  });
}

function isExtract(value: unknown): value is {
  target: "content";
  type: "extract";
  detail?: "structure" | "full" | "dom";
  selector?: string;
  maxNodes?: number;
  cursor?: string;
} {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.target === "content" && record.type === "extract";
}
