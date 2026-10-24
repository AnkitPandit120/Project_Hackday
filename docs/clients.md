# Clients

Both clients launch the server and speak MCP over stdio. They discover tools with `initialize` and `tools/list`. The model does not scan the repository for tools.

Build first so `apps/mcp-server/dist/index.js` exists. Use an absolute path. A relative path is a common reason the client starts a process that exits immediately.

Cursor, project `.cursor/mcp.json` or the user MCP config:

```json
{
  "mcpServers": {
    "snapcrawl": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/Project_Hackday/apps/mcp-server/dist/index.js"]
    }
  }
}
```

Codex CLI, `~/.codex/config.toml`. Confirm the table name against the Codex version you have installed; the current CLI uses `mcp_servers`:

```toml
[mcp_servers.snapcrawl]
command = "node"
args = ["/ABSOLUTE/PATH/Project_Hackday/apps/mcp-server/dist/index.js"]
```

Templates with a placeholder path are in `examples/cursor.mcp.json` and `examples/codex.config.toml`.

Before connecting a model, you can inspect the tools with:

```bash
npx @modelcontextprotocol/inspector node apps/mcp-server/dist/index.js
```

The pairing code is printed on stderr. Paste it into the extension. Do not put it in the MCP config.
