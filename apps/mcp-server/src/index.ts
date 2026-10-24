import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { encodePairingCode } from "@snapcrawl/shared";
import { startBridge } from "./bridge/ws-server.js";
import { createMcpServer } from "./server.js";

const token = randomBytes(32).toString("base64url");
const bridge = await startBridge({ token });
const code = encodePairingCode(bridge.port, token);
console.error("SnapCrawl MCP server");
console.error(`Pairing code: ${code}`);
console.error("Paste this code into the SnapCrawl extension.");
console.error(`Listening on 127.0.0.1:${bridge.port}`);

if (process.env.SNAPCRAWL_PAIRING_FILE) {
  writeFileSync(process.env.SNAPCRAWL_PAIRING_FILE, code, { mode: 0o600 });
}

const server = createMcpServer(bridge);
await server.connect(new StdioServerTransport());
