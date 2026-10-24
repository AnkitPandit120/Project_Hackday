# SnapCrawl

SnapCrawl lets Cursor or Codex read a page you already have open in Chrome. The assistant gets a sanitized snapshot of a tab you authorize. The login stays in the browser.

## What the first build does

- Pair a local MCP server with the extension using a one-time code.
- Authorize one or more tabs. Grants last until you revoke them or quit Chrome.
- Call `list_tabs`, `crawl_page`, and `get_page_structure` for a read of the current page.
- Optionally allow same-origin link navigation, a one-page-at-a-time crawl, element inspection, and a capped DOM tree.

SnapCrawl does not read cookies or web storage, does not return input values, and does not click buttons or submit forms.

## Run it

```bash
pnpm install
pnpm --filter @snapcrawl/demo-app dev
pnpm build
node apps/mcp-server/dist/index.js
```

The server prints a pairing code on stderr. Load `apps/extension/dist` as an unpacked extension, paste the code, and authorize the demo tab at `http://127.0.0.1:8787` (`demo` / `demo`).

Point Cursor at the built server with an absolute path. See [docs/clients.md](docs/clients.md).

```bash
pnpm test
pnpm build && pnpm exec playwright install chromium && pnpm test:e2e
```

Stdout of the MCP process is the protocol. Logs go to stderr.
