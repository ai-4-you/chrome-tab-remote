# chrome-tab-remote

Give an AI agent **consent-based, observe-only access to exactly one Chrome tab** via MCP. A Chrome extension mints a short-lived, origin-pinned grant from an explicit user gesture; a native-messaging host bridges that grant to MCP tools over local HTTP. Design details: [plan.md](./plan.md).

## Quickstart

```bash
npm install
npm run build
```

1. **Load the extension:** `chrome://extensions` → enable Developer mode → "Load unpacked" → select `packages/extension/dist`. Note the extension ID.
2. **Install the native host:**
   ```bash
   node packages/host/scripts/install-native-host.mjs <extension-id>
   ```
3. **Grant access:** open the side panel on a tab → "Grant observe access (30 min)".
4. **Connect an MCP client** (Streamable HTTP) to `http://127.0.0.1:8917/mcp` (override port with `CTR_MCP_PORT`).

## MCP tools

| Tool | Params | Returns |
|---|---|---|
| `list_grants` | — | Current grants (id, origin, mode, status, expiry) |
| `tab_snapshot` | `grantId` | Accessibility-style tree of the granted tab (`{ url, title, capturedAt, truncated, tree }`, refs `n0…`, capped at 1500 nodes) |
| `tab_read` | `grantId`, `ref` | Full text of one node from the latest snapshot |

## Trust model

- **Explicit consent:** grants are minted only from a user gesture in the side panel — never programmatically.
- **One tab, observe-only:** a grant covers exactly one tab; Stage 1 has no write/act capabilities and at most one active grant.
- **Origin-pinned:** if the tab navigates to a different origin the grant is suspended until the user re-confirms.
- **Short-lived and revocable:** 30-minute expiry; revoked on tab close or via the side panel; every tool call re-validates the grant.
- **Audited:** every lifecycle event and tool call is logged in the extension (side panel) and appended to `~/.chrome-tab-remote/audit.jsonl` (`CTR_DATA_DIR` overrides).

**Known gap (Stage 1):** the local MCP endpoint has **no authentication** — any process on this machine can call the tools while a grant is active. It binds to `127.0.0.1` only and rejects foreign `Host`/`Origin` headers (DNS-rebinding protection), but token auth is deliberately deferred to Stage 2 hardening. Uninstall the native host with `node packages/host/scripts/install-native-host.mjs --uninstall`.

## Development

```bash
./precommit.sh   # typecheck + lint + tests + npm audit — run before every commit
```

Workspaces: `packages/shared` (zod protocol schemas — canonical), `packages/extension` (MV3 extension), `packages/host` (native-messaging host + MCP server).
