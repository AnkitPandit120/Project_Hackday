# Bridge protocol

Version 1. JSON text frames. The token is the first message, not a URL parameter.

Extension to server:

- `{ "v": 1, "type": "auth", "token", "extensionId" }`
- `{ "v": 1, "type": "pong" }`
- `{ "v": 1, "type": "cancel-crawl", "crawlId"? }`
- `{ "v": 1, "type": "revoke" }`
- `{ "v": 1, "type": "result", "id", "ok": true, "result" }`
- `{ "v": 1, "type": "result", "id", "ok": false, "error": { "code", "message" } }`

Server to extension:

- `{ "v": 1, "type": "welcome" }`
- `{ "v": 1, "type": "ping" }`
- `{ "v": 1, "type": "request", "id", "method", "params", "deadline" }`
- `{ "v": 1, "type": "cancel", "id" }`

Methods: `listTabs`, `extract`, `navigate`.

The server binds `127.0.0.1` only. The first frame must authenticate within 3 seconds. The token is compared in constant time. The `Origin` must be `chrome-extension://<id>` when it is present, and that id is pinned for the life of the process. A later connection from the same extension replaces the socket. A different extension id is rejected.

`SNAPCRAWL_PAIRING_FILE` writes the pairing code for tests. The product path is the stderr banner, which the user pastes into the popup.
