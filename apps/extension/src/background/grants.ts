import type { TabGrant } from "../messages.js";

const GRANTS = "grants";
const PAIRING = "pairing";
const STATUS = "status";

export async function readGrants(): Promise<TabGrant[]> {
  const stored = await chrome.storage.session.get(GRANTS);
  const value = stored[GRANTS];
  if (!Array.isArray(value)) return [];
  return value.filter(isGrant);
}

export async function writeGrants(grants: TabGrant[]): Promise<void> {
  await chrome.storage.session.set({ [GRANTS]: grants });
  await chrome.action.setBadgeBackgroundColor({ color: "#0f766e" });
  await chrome.action.setBadgeText({ text: grants.length > 0 ? String(grants.length) : "" });
}

export async function readPairing(): Promise<{ port: number; token: string } | null> {
  const stored = await chrome.storage.session.get(PAIRING);
  const value = stored[PAIRING];
  if (!isRecord(value) || typeof value.port !== "number" || typeof value.token !== "string") return null;
  return { port: value.port, token: value.token };
}

export async function writePairing(pairing: { port: number; token: string } | null): Promise<void> {
  if (!pairing) {
    await chrome.storage.session.remove(PAIRING);
    return;
  }
  await chrome.storage.session.set({ [PAIRING]: pairing });
}

export async function readStatus(): Promise<{ connected: boolean; detail?: string }> {
  const stored = await chrome.storage.session.get(STATUS);
  const value = stored[STATUS];
  if (!isRecord(value) || typeof value.connected !== "boolean") return { connected: false };
  return typeof value.detail === "string" ? { connected: value.connected, detail: value.detail } : { connected: value.connected };
}

export async function writeStatus(status: { connected: boolean; detail?: string }): Promise<void> {
  await chrome.storage.session.set({ [STATUS]: status });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isGrant(value: unknown): value is TabGrant {
  if (!isRecord(value)) return false;
  return (
    typeof value.tabId === "number" &&
    typeof value.origin === "string" &&
    typeof value.grantedAt === "string" &&
    typeof value.allowNavigation === "boolean" &&
    typeof value.allowCrawl === "boolean" &&
    typeof value.allowDom === "boolean"
  );
}
