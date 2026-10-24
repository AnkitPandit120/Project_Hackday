export const PROTOCOL_VERSION = 1 as const;

export const ERROR_CODES = [
  "NOT_PAIRED",
  "NOT_AUTHORIZED",
  "ORIGIN_MISMATCH",
  "TAB_CLOSED",
  "CONTENT_SCRIPT_UNAVAILABLE",
  "TIMEOUT",
  "CANCELLED",
  "BRIDGE_DISCONNECTED",
  "UNSAFE_NAVIGATION",
  "RATE_LIMITED",
  "SNAPSHOT_TOO_LARGE",
  "PROTOCOL_MISMATCH",
  "SELECTOR_INVALID",
  "NO_MATCH",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export type BridgeError = {
  code: ErrorCode;
  message: string;
};

export function bridgeError(code: ErrorCode, message: string): BridgeError {
  return { code, message };
}

export type BridgeMethod = "listTabs" | "extract" | "navigate";

export type ExtractDetail = "structure" | "full" | "dom";

export type ExtractParams = {
  tabId?: number;
  detail?: ExtractDetail;
  selector?: string;
  maxNodes?: number;
  cursor?: string;
};

export type NavigateParams = {
  tabId?: number;
  url: string;
};

export type ClientMessage =
  | { v: 1; type: "auth"; token: string; extensionId: string }
  | { v: 1; type: "pong" }
  | { v: 1; type: "cancel-crawl"; crawlId?: string }
  | { v: 1; type: "revoke" }
  | { v: 1; type: "result"; id: string; ok: true; result: unknown }
  | { v: 1; type: "result"; id: string; ok: false; error: BridgeError };

export type ServerMessage =
  | { v: 1; type: "welcome" }
  | { v: 1; type: "ping" }
  | { v: 1; type: "request"; id: string; method: BridgeMethod; params: unknown; deadline: number }
  | { v: 1; type: "cancel"; id: string };

const METHODS: readonly BridgeMethod[] = ["listTabs", "extract", "navigate"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && (ERROR_CODES as readonly string[]).includes(value);
}

function isBridgeError(value: unknown): value is BridgeError {
  if (!isRecord(value)) return false;
  return isErrorCode(value.code) && typeof value.message === "string";
}

export function parseClientMessage(value: unknown): ClientMessage | null {
  if (!isRecord(value) || value.v !== 1 || typeof value.type !== "string") return null;
  switch (value.type) {
    case "auth":
      if (typeof value.token !== "string" || typeof value.extensionId !== "string") return null;
      return { v: 1, type: "auth", token: value.token, extensionId: value.extensionId };
    case "pong":
      return { v: 1, type: "pong" };
    case "cancel-crawl":
      if (value.crawlId !== undefined && typeof value.crawlId !== "string") return null;
      return value.crawlId === undefined
        ? { v: 1, type: "cancel-crawl" }
        : { v: 1, type: "cancel-crawl", crawlId: value.crawlId };
    case "revoke":
      return { v: 1, type: "revoke" };
    case "result":
      if (typeof value.id !== "string" || typeof value.ok !== "boolean") return null;
      if (value.ok) return { v: 1, type: "result", id: value.id, ok: true, result: value.result };
      if (!isBridgeError(value.error)) return null;
      return { v: 1, type: "result", id: value.id, ok: false, error: value.error };
    default:
      return null;
  }
}

export function parseServerMessage(value: unknown): ServerMessage | null {
  if (!isRecord(value) || value.v !== 1 || typeof value.type !== "string") return null;
  switch (value.type) {
    case "welcome":
      return { v: 1, type: "welcome" };
    case "ping":
      return { v: 1, type: "ping" };
    case "cancel":
      if (typeof value.id !== "string") return null;
      return { v: 1, type: "cancel", id: value.id };
    case "request":
      if (typeof value.id !== "string" || typeof value.deadline !== "number") return null;
      if (typeof value.method !== "string" || !METHODS.includes(value.method as BridgeMethod)) return null;
      return {
        v: 1,
        type: "request",
        id: value.id,
        method: value.method as BridgeMethod,
        params: value.params,
        deadline: value.deadline,
      };
    default:
      return null;
  }
}
