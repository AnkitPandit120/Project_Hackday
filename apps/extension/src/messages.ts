import { ERROR_CODES, type BridgeMethod, type ClientMessage, type ErrorCode, type ExtractDetail } from "@snapcrawl/shared";

export type GrantFlags = {
  allowNavigation: boolean;
  allowCrawl: boolean;
  allowDom: boolean;
};

export type TabGrant = GrantFlags & {
  tabId: number;
  origin: string;
  grantedAt: string;
};

export type Pairing = {
  port: number;
  token: string;
};

export type ExtensionStatus = {
  connected: boolean;
  paired: boolean;
  detail?: string;
  grants: TabGrant[];
};

export type BackgroundRequest =
  | { target: "background"; type: "pair"; code: string }
  | { target: "background"; type: "revoke" }
  | ({ target: "background"; type: "grant"; tabId: number; origin: string } & GrantFlags)
  | ({ target: "background"; type: "update-flags" } & GrantFlags)
  | { target: "background"; type: "revoke-tab"; tabId: number }
  | { target: "background"; type: "stop-crawl" }
  | { target: "background"; type: "get-status" }
  | { target: "background"; type: "heartbeat" }
  | { target: "background"; type: "bridge-status"; connected: boolean; detail?: string }
  | { target: "background"; type: "bridge-request"; id: string; method: BridgeMethod; params: unknown };

export type OffscreenRequest =
  | { target: "offscreen"; type: "connect"; port: number; token: string; extensionId: string }
  | { target: "offscreen"; type: "disconnect" }
  | { target: "offscreen"; type: "cancel-crawl" };

export type ContentRequest = {
  target: "content";
  type: "extract";
  detail?: ExtractDetail;
  selector?: string;
  maxNodes?: number;
  cursor?: string;
};

export type ContentResponse =
  | { ok: true; result: unknown }
  | { ok: false; error: { code: string; message: string } };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasFlags(value: Record<string, unknown>): boolean {
  return (
    typeof value.allowNavigation === "boolean" &&
    typeof value.allowCrawl === "boolean" &&
    typeof value.allowDom === "boolean"
  );
}

export function parseBackgroundRequest(value: unknown): BackgroundRequest | null {
  if (!isRecord(value) || value.target !== "background" || typeof value.type !== "string") return null;
  switch (value.type) {
    case "pair":
      return typeof value.code === "string" ? { target: "background", type: "pair", code: value.code } : null;
    case "revoke":
      return { target: "background", type: "revoke" };
    case "grant":
      if (typeof value.tabId !== "number" || typeof value.origin !== "string" || !hasFlags(value)) return null;
      return {
        target: "background",
        type: "grant",
        tabId: value.tabId,
        origin: value.origin,
        allowNavigation: value.allowNavigation as boolean,
        allowCrawl: value.allowCrawl as boolean,
        allowDom: value.allowDom as boolean,
      };
    case "update-flags":
      if (!hasFlags(value)) return null;
      return {
        target: "background",
        type: "update-flags",
        allowNavigation: value.allowNavigation as boolean,
        allowCrawl: value.allowCrawl as boolean,
        allowDom: value.allowDom as boolean,
      };
    case "revoke-tab":
      return typeof value.tabId === "number" ? { target: "background", type: "revoke-tab", tabId: value.tabId } : null;
    case "stop-crawl":
      return { target: "background", type: "stop-crawl" };
    case "get-status":
      return { target: "background", type: "get-status" };
    case "heartbeat":
      return { target: "background", type: "heartbeat" };
    case "bridge-status":
      if (typeof value.connected !== "boolean") return null;
      return value.detail === undefined
        ? { target: "background", type: "bridge-status", connected: value.connected }
        : { target: "background", type: "bridge-status", connected: value.connected, detail: String(value.detail) };
    case "bridge-request":
      if (typeof value.id !== "string" || typeof value.method !== "string") return null;
      if (value.method !== "listTabs" && value.method !== "extract" && value.method !== "navigate") return null;
      return { target: "background", type: "bridge-request", id: value.id, method: value.method, params: value.params };
    default:
      return null;
  }
}

export function sendRuntimeMessage<T>(message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(message, (response: T) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          reject(new Error(runtimeError.message));
          return;
        }
        resolve(response);
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error("Extension message failed."));
    }
  });
}

export function resultMessage(id: string, response: ContentResponse): ClientMessage {
  if (response.ok) return { v: 1, type: "result", id, ok: true, result: response.result };
  return { v: 1, type: "result", id, ok: false, error: { code: asErrorCode(response.error.code), message: response.error.message } };
}

function asErrorCode(code: string): ErrorCode {
  return (ERROR_CODES as readonly string[]).includes(code) ? (code as ErrorCode) : "CONTENT_SCRIPT_UNAVAILABLE";
}
