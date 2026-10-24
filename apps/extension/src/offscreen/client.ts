import { LIMITS, assertNever, parseServerMessage, type ClientMessage } from "@snapcrawl/shared";
import { sendRuntimeMessage } from "../messages.js";

type OffscreenCommand =
  | { target: "offscreen"; type: "connect"; port: number; token: string; extensionId: string }
  | { target: "offscreen"; type: "disconnect" }
  | { target: "offscreen"; type: "cancel-crawl" };

let socket: WebSocket | null = null;
let port = 0;
let token = "";
let extensionId = "";
let stopped = true;
let attempts = 0;
let reconnectTimer = 0;
let welcomed = false;

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  const command = parseCommand(message);
  if (!command) return;
  switch (command.type) {
    case "connect":
      port = command.port;
      token = command.token;
      extensionId = command.extensionId;
      stopped = false;
      attempts = 0;
      openSocket();
      sendResponse({ ok: true });
      break;
    case "disconnect":
      stopped = true;
      window.clearTimeout(reconnectTimer);
      sendFrame({ v: 1, type: "revoke" });
      closeSocket();
      sendResponse({ ok: true });
      break;
    case "cancel-crawl":
      sendFrame({ v: 1, type: "cancel-crawl" });
      sendResponse({ ok: true });
      break;
    default:
      assertNever(command);
  }
  return true;
});

window.setInterval(() => {
  if (socket?.readyState === WebSocket.OPEN) sendFrame({ v: 1, type: "pong" });
  try {
    chrome.runtime.sendMessage({ target: "background", type: "heartbeat" });
  } catch {
    // The worker may already be gone. The next alarm recreates this document.
  }
}, LIMITS.heartbeatMs);

function openSocket() {
  closeSocket();
  welcomed = false;
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  socket = ws;
  ws.addEventListener("open", () => {
    sendFrame({ v: 1, type: "auth", token, extensionId });
    window.setTimeout(() => {
      if (welcomed || stopped || socket !== ws) return;
      ws.close();
    }, LIMITS.authTimeoutMs);
  });
  ws.addEventListener("message", (event) => {
    void onFrame(ws, String(event.data));
  });
  ws.addEventListener("close", (event) => {
    if (socket !== ws) return;
    socket = null;
    const terminal = event.code === 4001 || event.code === 4003 || event.code === 4008;
    void report(false, closeDetail(event.code));
    if (stopped || terminal) {
      stopped = true;
      return;
    }
    scheduleReconnect();
  });
}

async function onFrame(ws: WebSocket, raw: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  const message = parseServerMessage(parsed);
  if (!message || socket !== ws) return;
  switch (message.type) {
    case "welcome":
      welcomed = true;
      attempts = 0;
      await report(true, "Connected.");
      break;
    case "ping":
      sendFrame({ v: 1, type: "pong" });
      break;
    case "cancel":
      break;
    case "request":
      await answer(message.id, message.method, message.params);
      break;
    default:
      assertNever(message);
  }
}

async function answer(id: string, method: "listTabs" | "extract" | "navigate", params: unknown) {
  try {
    const response = await sendRuntimeMessage<ClientMessage>({
      target: "background",
      type: "bridge-request",
      id,
      method,
      params,
    });
    sendFrame(response);
  } catch {
    sendFrame({
      v: 1,
      type: "result",
      id,
      ok: false,
      error: { code: "BRIDGE_DISCONNECTED", message: "The extension worker did not answer." },
    });
  }
}

function scheduleReconnect() {
  attempts += 1;
  if (attempts > LIMITS.reconnectMaxAttempts) {
    stopped = true;
    void report(false, "Reconnect failed. Pair the extension again.");
    return;
  }
  const delay = Math.min(1_000 * 2 ** (attempts - 1), LIMITS.reconnectMaxMs);
  reconnectTimer = window.setTimeout(() => {
    if (!stopped) openSocket();
  }, delay);
}

function sendFrame(message: ClientMessage) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  try {
    socket.send(JSON.stringify(message));
  } catch {
    // The socket can close between the state check and the write.
  }
}

function closeSocket() {
  const current = socket;
  socket = null;
  if (!current) return;
  try {
    current.close();
  } catch {
    // Already closed.
  }
}

async function report(connected: boolean, detail: string) {
  try {
    await sendRuntimeMessage({ target: "background", type: "bridge-status", connected, detail });
  } catch {
    // Status is best-effort while the worker restarts.
  }
}

function closeDetail(code: number): string {
  switch (code) {
    case 4001:
      return "Protocol mismatch. Update SnapCrawl and pair again.";
    case 4003:
      return "Pairing was rejected.";
    case 4008:
      return "Another client is already connected.";
    default:
      return "Disconnected. Reconnecting.";
  }
}

function parseCommand(value: unknown): OffscreenCommand | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record.target !== "offscreen" || typeof record.type !== "string") return null;
  switch (record.type) {
    case "connect":
      if (typeof record.port !== "number" || typeof record.token !== "string" || typeof record.extensionId !== "string") {
        return null;
      }
      return { target: "offscreen", type: "connect", port: record.port, token: record.token, extensionId: record.extensionId };
    case "disconnect":
      return { target: "offscreen", type: "disconnect" };
    case "cancel-crawl":
      return { target: "offscreen", type: "cancel-crawl" };
    default:
      return null;
  }
}
