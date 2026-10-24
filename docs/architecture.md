# Architecture

SnapCrawl is a Manifest V3 extension plus a stdio MCP server.

Cursor or Codex launches `apps/mcp-server`. That process speaks MCP on stdin and stdout, and listens on `127.0.0.1` with an ephemeral port. The extension's offscreen document is the WebSocket client. The service worker is the only context that may use `chrome.tabs`, `chrome.permissions`, and `chrome.scripting`. The content script reads the DOM of a tab the user authorized and returns a `PageSnapshot`.

The service worker does not hold the socket. Chrome suspends idle workers, and an open socket in the worker dies with it. The offscreen document heartbeats every 20 seconds and the worker recreates that document from a 30 second alarm.

Native messaging is a poor fit because Chrome and the MCP client would both need the process's standard streams. Plain HTTP is reserved as a fallback if the socket cannot survive a real Chrome session.

`chrome.debugger` is intentionally unused. It shows a debugging banner and can do more than read the page.
