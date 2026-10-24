import { LIMITS, assertNever, decodePairingCode, originOf } from "@snapcrawl/shared";
import {
  parseBackgroundRequest,
  resultMessage,
  sendRuntimeMessage,
  type ExtensionStatus,
  type GrantFlags,
} from "../messages.js";
import { readGrants, readPairing, readStatus, writeGrants, writePairing, writeStatus } from "./grants.js";
import { handleMethod } from "./router.js";

chrome.runtime.onInstalled.addListener(() => {
  void ensureAlarm();
});

chrome.runtime.onStartup.addListener(() => {
  void restorePairing();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== "snapcrawl-keepalive") return;
  void restorePairing();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void dropTab(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, _info, tab) => {
  if (!tab.url) return;
  void dropIfOriginChanged(tabId, tab.url);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const request = parseBackgroundRequest(message);
  if (!request) return;
  void handleBackground(request)
    .then((response) => {
      try {
        sendResponse(response);
      } catch {
        // The worker can die between the handler and the port write.
      }
    })
    .catch((error: unknown) => {
      const text = error instanceof Error ? error.message : "Extension request failed.";
      try {
        sendResponse({ ok: false, error: text });
      } catch {
        // The port is already gone.
      }
    });
  return true;
});

async function handleBackground(request: ReturnType<typeof parseBackgroundRequest>) {
  if (!request) return { ok: false };
  switch (request.type) {
    case "pair":
      return pair(request.code);
    case "revoke":
      await revoke();
      return { ok: true };
    case "grant":
      return grant(request);
    case "update-flags":
      return updateFlags(request);
    case "revoke-tab":
      await dropTab(request.tabId);
      return { ok: true };
    case "stop-crawl":
      await sendToOffscreen({ target: "offscreen", type: "cancel-crawl" });
      return { ok: true };
    case "get-status":
      return status();
    case "heartbeat":
      return { ok: true };
    case "bridge-status":
      await writeStatus({ connected: request.connected, detail: request.detail });
      return { ok: true };
    case "bridge-request": {
      const response = await handleMethod(request.method, request.params);
      return resultMessage(request.id, response);
    }
    default:
      return assertNever(request);
  }
}

async function pair(code: string) {
  const pairing = decodePairingCode(code);
  if (!pairing) return { ok: false, error: "That pairing code is not valid." };
  await writePairing({ port: pairing.port, token: pairing.token });
  await connectOffscreen(pairing.port, pairing.token);
  return { ok: true };
}

async function grant(request: { tabId: number; origin: string } & GrantFlags) {
  const grants = await readGrants();
  const next = grants.filter((item) => item.tabId !== request.tabId);
  next.push({
    tabId: request.tabId,
    origin: request.origin,
    grantedAt: new Date().toISOString(),
    allowNavigation: request.allowNavigation,
    allowCrawl: request.allowCrawl,
    allowDom: request.allowDom,
  });
  await writeGrants(next);
  return { ok: true };
}

async function updateFlags(flags: GrantFlags) {
  const grants = await readGrants();
  await writeGrants(grants.map((grant) => ({ ...grant, ...flags })));
  return { ok: true };
}

async function revoke() {
  const grants = await readGrants();
  const origins = [...new Set(grants.map((grant) => `${grant.origin}/*`))];
  if (origins.length > 0) {
    await chrome.permissions.remove({ origins }).catch(() => undefined);
  }
  await writeGrants([]);
  await writePairing(null);
  await writeStatus({ connected: false, detail: "Disconnected." });
  await sendToOffscreen({ target: "offscreen", type: "disconnect" });
}

async function dropTab(tabId: number) {
  const grants = await readGrants();
  const grant = grants.find((item) => item.tabId === tabId);
  if (!grant) return;
  const remaining = grants.filter((item) => item.tabId !== tabId);
  await writeGrants(remaining);
  if (!remaining.some((item) => item.origin === grant.origin)) {
    await chrome.permissions.remove({ origins: [`${grant.origin}/*`] }).catch(() => undefined);
  }
}

async function dropIfOriginChanged(tabId: number, url: string) {
  const grants = await readGrants();
  const grant = grants.find((item) => item.tabId === tabId);
  if (!grant) return;
  if (originOf(url) === grant.origin) return;
  await writeGrants(grants.filter((item) => item.tabId !== tabId));
}

async function status(): Promise<ExtensionStatus> {
  const [pairing, connection, grants] = await Promise.all([readPairing(), readStatus(), readGrants()]);
  return {
    connected: connection.connected,
    paired: pairing !== null,
    detail: connection.detail,
    grants,
  };
}

async function restorePairing() {
  const pairing = await readPairing();
  if (!pairing) return;
  await connectOffscreen(pairing.port, pairing.token);
}

async function connectOffscreen(port: number, token: string) {
  await ensureOffscreen();
  await sendToOffscreen({
    target: "offscreen",
    type: "connect",
    port,
    token,
    extensionId: chrome.runtime.id,
  });
}

async function ensureOffscreen() {
  const url = chrome.runtime.getURL("offscreen.html");
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [url],
  });
  if (contexts.length > 0) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["WORKERS"],
    justification: "Keep a localhost WebSocket open so the local MCP server can request authorized tab snapshots.",
  });
}

async function ensureAlarm() {
  await chrome.alarms.create("snapcrawl-keepalive", { periodInMinutes: LIMITS.alarmPeriodMinutes });
}

async function sendToOffscreen(message: unknown) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await sendRuntimeMessage(message);
      return;
    } catch {
      await delay(50);
    }
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
