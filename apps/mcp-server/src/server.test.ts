import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { LIMITS, type PageSnapshot } from "@snapcrawl/shared";
import { startBridge } from "./bridge/ws-server.js";
import type { Bridge } from "./bridge/types.js";
import { CrawlEngine, type Clock } from "./crawl/engine.js";
import { createMcpServer } from "./server.js";

const EXTENSION_ID = "abcdefghijklmnopqrstuvwxyzabcdef";

const closers: Array<() => Promise<void>> = [];

describe("local bridge", () => {
  afterEach(async () => {
    await Promise.all(closers.splice(0).map((close) => close()));
  });

  it("authenticates one extension and correlates a result", async () => {
    const bridge = await listen();
    const socket = await connect(bridge.port, EXTENSION_ID, "token-token-token-token");
    const pending = bridge.request("listTabs", {}, 1_000);
    const request = JSON.parse(await nextMessage(socket)) as { id: string };
    socket.send(JSON.stringify({ v: 1, type: "result", id: request.id, ok: true, result: { tabs: [] } }));
    await expect(pending).resolves.toEqual({ tabs: [] });
  });

  it("closes a bad token and a second extension id", async () => {
    const bridge = await listen();
    const rejected = await connect(bridge.port, EXTENSION_ID, "wrong-token-wrong-token-xx", false);
    await expect(closed(rejected)).resolves.toBe(4003);

    const first = await connect(bridge.port, EXTENSION_ID, "token-token-token-token");
    const other = await connect(bridge.port, "zyxwvutsrqponmlkjihgfedcbazyxwvu", "token-token-token-token", false);
    await expect(closed(other)).resolves.toBe(4003);
    expect(first.readyState).toBe(WebSocket.OPEN);
  });

  it("fails an in-flight request when the socket drops", async () => {
    const bridge = await listen();
    const socket = await connect(bridge.port, EXTENSION_ID, "token-token-token-token");
    const pending = bridge.request("extract", {}, 1_000);
    await nextMessage(socket);
    socket.close();
    await expect(pending).rejects.toMatchObject({ code: "BRIDGE_DISCONNECTED" });
  });

  it("keeps a revoke as not authorized after the socket closes", async () => {
    const bridge = await listen();
    const socket = await connect(bridge.port, EXTENSION_ID, "token-token-token-token");
    socket.send(JSON.stringify({ v: 1, type: "revoke" }));
    const closing = closed(socket);
    socket.close();
    await closing;
    await expect(bridge.request("listTabs", {}, 1_000)).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
  });
});

describe("crawl engine", () => {
  it("skips logout links and stops at the hard page cap", async () => {
    const navigated: string[] = [];
    let current = "https://app.example/admin";
    const bridge = fakeBridge(async (method, params) => {
      if (method === "listTabs") return tabList(current);
      if (method === "navigate") {
        const url = (params as { url?: string }).url ?? "";
        navigated.push(url);
        current = url;
        return { finalUrl: url, status: "complete" };
      }
      const path = new URL(current).pathname;
      if (path === "/admin") return page(current, "Dashboard", ["/admin/users", "/logout", "/admin/settings"]);
      if (path === "/admin/users") return page(current, "Users", []);
      if (path === "/admin/settings") return page(current, "Settings", ["/admin"]);
      const next = Number(path.split("/").at(-1) ?? 0) + 1;
      return page(current, `Page ${path}`, [`https://app.example/p/${next}`]);
    });
    let now = 0;
    const clock: Clock = { now: () => now, sleep: async (ms) => { now += ms; } };
    const engine = new CrawlEngine(bridge, clock);
    const first = await engine.crawlWebsite({});
    expect(first.page?.title).toBe("Dashboard");
    expect(navigated).toEqual([]);
    const second = await engine.crawlWebsite({ crawlId: first.crawlId });
    expect(second.page?.title).toBe("Users");
    expect(navigated.some((url) => url.includes("/logout"))).toBe(false);
    const graph = engine.graph(first.crawlId);
    expect(graph.edges.some((edge) => edge.to.includes("/admin/users"))).toBe(true);
    expect(() => engine.graph("00000000-0000-0000-0000-000000000000")).toThrow(/Unknown crawl/);

    current = "https://app.example/p/1";
    const wide = await engine.crawlWebsite({ maxPages: 10_000, maxDepth: 4, tabId: 1 });
    let steps = 1;
    let cursor = wide.crawlId;
    while (steps < 60) {
      const next = await engine.crawlWebsite({ crawlId: cursor });
      steps += 1;
      if (next.done && next.page === null) break;
    }
    const wideNavigations = navigated.filter((url) => url.includes("/p/"));
    expect(wideNavigations.length).toBeLessThanOrEqual(LIMITS.maxPagesHard - 1);
    expect(steps).toBeLessThanOrEqual(LIMITS.maxPagesHard + 1);
  });
});

describe("mcp tools", () => {
  it("lists tools and rejects a hostile tab id before touching the browser", async () => {
    const bridge = fakeBridge(async (method) => {
      if (method === "extract") return page("https://app.example/admin", "Dashboard", []);
      if (method === "listTabs") return tabList("https://app.example/admin");
      return {};
    });
    const server = createMcpServer(bridge);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(clientTransport);
    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["list_tabs", "crawl_page", "get_page_structure", "crawl_website", "navigate_page"]),
    );
    const rejected = await client.callTool({ name: "crawl_page", arguments: { tabId: "not-a-number" } });
    expect(rejected.isError).toBe(true);
    const accepted = await client.callTool({ name: "crawl_page", arguments: {} });
    expect(accepted.isError).toBeFalsy();
    const text = textOf(accepted);
    expect(text.startsWith("UNTRUSTED_PAGE_CONTENT")).toBe(true);
    expect(text).not.toContain("super-secret-password");
    await client.close();
    await server.close();
  });
});

describe("server source", () => {
  it("does not write to stdout with console.log", () => {
    for (const path of files("src")) {
      if (path.endsWith(".test.ts")) continue;
      expect(readFileSync(path, "utf8"), path).not.toMatch(/console\.log\s*\(/);
    }
  });
});

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

async function listen() {
  const bridge = await startBridge({
    token: "token-token-token-token",
    authTimeoutMs: 400,
    heartbeatMs: 60_000,
    heartbeatMissMs: 120_000,
    bridgeWaitMs: 500,
  });
  closers.push(() => bridge.close());
  return bridge;
}

function connect(port: number, extensionId: string, token: string, authenticate = true): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`, {
    headers: { origin: `chrome-extension://${extensionId}` },
  });
  return new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.once("open", () => {
      if (authenticate) {
        socket.send(JSON.stringify({ v: 1, type: "auth", token, extensionId }));
        void nextMessage(socket).then((raw) => {
          const message = JSON.parse(raw) as { type?: string };
          if (message.type !== "welcome") reject(new Error(`expected welcome, got ${raw}`));
          else resolve(socket);
        }).catch(reject);
        return;
      }
      socket.send(JSON.stringify({ v: 1, type: "auth", token, extensionId }));
      resolve(socket);
    });
  });
}

function nextMessage(socket: WebSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    socket.once("message", (data) => resolve(data.toString()));
    socket.once("error", reject);
  });
}

function closed(socket: WebSocket): Promise<number> {
  return new Promise((resolve) => {
    socket.once("close", (code) => resolve(code));
  });
}

function tabList(url: string) {
  return {
    tabs: [{
      tabId: 1,
      title: "Admin",
      origin: "https://app.example",
      urlWithoutQuery: url,
      active: true,
      granted: true,
      allowNavigation: true,
      allowCrawl: true,
      allowDom: false,
    }],
  };
}

function page(url: string, title: string, links: string[]): PageSnapshot {
  const origin = new URL(url).origin;
  return {
    url,
    title,
    capturedAt: "2026-10-24T00:00:00.000Z",
    origin,
    headings: [{ level: 1, text: title }],
    landmarks: [],
    linksInternal: links.filter((link) => link.startsWith("/") || link.startsWith(origin)).map((link) => ({
      text: link,
      path: link.startsWith("http") ? new URL(link).pathname : link,
    })),
    interactive: {
      links: links.map((link) => {
        const href = link.startsWith("http") ? link : new URL(link, origin).toString();
        return { text: link, href, path: new URL(href).pathname, sameOrigin: new URL(href).origin === origin };
      }),
      buttons: [{ text: "Delete account" }],
      forms: [],
    },
    warnings: [],
    truncated: false,
  };
}

function fakeBridge(handler: (method: string, params: unknown) => Promise<unknown>): Bridge {
  return {
    port: 0,
    isReady: () => true,
    waitUntilReady: async () => undefined,
    onCancel: () => undefined,
    cancelCrawls: () => undefined,
    close: async () => undefined,
    request: (method, params) => handler(method, params),
  };
}

function textOf(result: { content: unknown }): string {
  const content = result.content;
  if (!Array.isArray(content) || typeof content[0] !== "object" || content[0] === null) return "";
  const text = (content[0] as { text?: unknown }).text;
  return typeof text === "string" ? text : "";
}
