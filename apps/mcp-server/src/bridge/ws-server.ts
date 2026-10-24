import { randomUUID, timingSafeEqual } from "node:crypto";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import {
  LIMITS,
  assertNever,
  parseClientMessage,
  type BridgeMethod,
  type ClientMessage,
} from "@snapcrawl/shared";
import { BridgeFailure, type Bridge } from "./types.js";

export type BridgeServerOptions = {
  token: string;
  authTimeoutMs?: number;
  heartbeatMs?: number;
  heartbeatMissMs?: number;
  bridgeWaitMs?: number;
};

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

export async function startBridge(options: BridgeServerOptions): Promise<Bridge> {
  const bridge = new LocalBridge(options);
  await bridge.listen();
  return bridge;
}

class LocalBridge implements Bridge {
  port = 0;
  private readonly sockets = new Set<WebSocket>();
  private socket: WebSocket | null = null;
  private extensionId: string | null = null;
  private ready = false;
  private revoked = false;
  private readonly pending = new Map<string, Pending>();
  private readonly cancelListeners = new Set<(crawlId?: string) => void>();
  private wss: WebSocketServer | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private missed: NodeJS.Timeout | null = null;
  private lastPong = 0;
  private readonly authTimeoutMs: number;
  private readonly heartbeatMs: number;
  private readonly heartbeatMissMs: number;
  private readonly bridgeWaitMs: number;

  constructor(private readonly options: BridgeServerOptions) {
    this.authTimeoutMs = options.authTimeoutMs ?? LIMITS.authTimeoutMs;
    this.heartbeatMs = options.heartbeatMs ?? LIMITS.heartbeatMs;
    this.heartbeatMissMs = options.heartbeatMissMs ?? LIMITS.heartbeatMissMs;
    this.bridgeWaitMs = options.bridgeWaitMs ?? LIMITS.bridgeWaitMs;
  }

  async listen(): Promise<void> {
    const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    this.wss = wss;
    await new Promise<void>((resolve, reject) => {
      wss.once("listening", () => resolve());
      wss.once("error", reject);
    });
    const address = wss.address();
    if (!address || typeof address === "string") throw new Error("Bridge did not bind to a TCP port.");
    this.port = address.port;
    wss.on("connection", (socket, request) => this.onConnection(socket, request.headers.origin));
    this.heartbeat = setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({ v: 1, type: "ping" }));
      }
    }, this.heartbeatMs);
    this.heartbeat.unref();
    this.missed = setInterval(() => {
      if (!this.ready || this.lastPong === 0) return;
      if (Date.now() - this.lastPong > this.heartbeatMissMs) this.socket?.close(4000, "heartbeat");
    }, Math.min(this.heartbeatMs, 1_000));
    this.missed.unref();
  }

  isReady(): boolean {
    return this.ready && this.socket?.readyState === WebSocket.OPEN;
  }

  async waitUntilReady(timeoutMs: number): Promise<void> {
    const start = Date.now();
    while (!this.isReady()) {
      if (Date.now() - start >= timeoutMs) {
        throw new BridgeFailure("BRIDGE_DISCONNECTED", "The extension is not connected.");
      }
      await delay(25);
    }
  }

  async request(method: BridgeMethod, params: unknown, timeoutMs: number): Promise<unknown> {
    if (this.revoked) {
      throw new BridgeFailure("NOT_AUTHORIZED", "The extension was revoked. Pair it again and authorize a tab.");
    }
    await this.waitUntilReady(Math.min(timeoutMs, this.bridgeWaitMs));
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new BridgeFailure("BRIDGE_DISCONNECTED", "The extension is not connected.");
    }
    const id = randomUUID();
    const result = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new BridgeFailure("TIMEOUT", "The browser did not answer in time."));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
    socket.send(JSON.stringify({ v: 1, type: "request", id, method, params, deadline: Date.now() + timeoutMs }));
    return result;
  }

  cancelCrawls(crawlId?: string): void {
    for (const listener of this.cancelListeners) listener(crawlId);
  }

  onCancel(listener: (crawlId?: string) => void): void {
    this.cancelListeners.add(listener);
  }

  async close(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.missed) clearInterval(this.missed);
    this.failPending("BRIDGE_DISCONNECTED", "The bridge closed.");
    for (const socket of this.sockets) socket.close();
    await new Promise<void>((resolve) => {
      if (!this.wss) {
        resolve();
        return;
      }
      this.wss.close(() => resolve());
    });
    this.ready = false;
  }

  private onConnection(socket: WebSocket, origin: string | undefined): void {
    this.sockets.add(socket);
    if (origin && !origin.startsWith("chrome-extension://")) {
      socket.close(4003, "origin");
      return;
    }
    let authenticated = false;
    const authTimer = setTimeout(() => {
      if (!authenticated) socket.close(4003, "auth-timeout");
    }, this.authTimeoutMs);
    socket.on("message", (data) => {
      const message = parseFrame(data);
      if (!message) {
        socket.close(4001, "protocol");
        return;
      }
      if (!authenticated) {
        if (message.type !== "auth" || !tokensMatch(message.token, this.options.token)) {
          socket.close(4003, "auth");
          return;
        }
        if (origin && origin !== `chrome-extension://${message.extensionId}`) {
          socket.close(4003, "origin");
          return;
        }
        if (this.extensionId && this.extensionId !== message.extensionId) {
          socket.close(4003, "extension");
          return;
        }
        const previous = this.socket;
        if (previous && previous !== socket && previous.readyState === WebSocket.OPEN) {
          this.failPending("BRIDGE_DISCONNECTED", "The extension reconnected.");
        }
        authenticated = true;
        clearTimeout(authTimer);
        this.extensionId = message.extensionId;
        this.socket = socket;
        this.ready = true;
        this.revoked = false;
        this.lastPong = Date.now();
        if (previous && previous !== socket) previous.close(4000, "replaced");
        socket.send(JSON.stringify({ v: 1, type: "welcome" }));
        return;
      }
      if (socket !== this.socket) return;
      switch (message.type) {
        case "auth":
          break;
        case "pong":
          this.lastPong = Date.now();
          break;
        case "cancel-crawl":
          this.cancelCrawls(message.crawlId);
          break;
        case "revoke":
          this.revoked = true;
          this.ready = false;
          this.cancelCrawls();
          break;
        case "result":
          this.settle(message);
          break;
        default:
          assertNever(message);
      }
    });
    socket.on("close", () => {
      clearTimeout(authTimer);
      this.sockets.delete(socket);
      if (this.socket !== socket) return;
      this.socket = null;
      this.ready = false;
      this.failPending("BRIDGE_DISCONNECTED", "The extension disconnected.");
    });
  }

  private settle(message: Extract<ClientMessage, { type: "result" }>): void {
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if (message.ok) pending.resolve(message.result);
    else pending.reject(new BridgeFailure(message.error.code, message.error.message));
  }

  private failPending(code: "BRIDGE_DISCONNECTED", message: string): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new BridgeFailure(code, message));
      this.pending.delete(id);
    }
  }
}

function parseFrame(data: RawData): ClientMessage | null {
  try {
    return parseClientMessage(JSON.parse(rawText(data)));
  } catch {
    return null;
  }
}

function rawText(data: RawData): string {
  if (typeof data === "string") return data;
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return data.toString("utf8");
}

function tokensMatch(provided: string, expected: string): boolean {
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
