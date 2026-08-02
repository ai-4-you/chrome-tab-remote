# Chrome Tab Remote

**Let an AI agent see exactly one browser tab — the one you chose, for as long as you allow, and nothing else.**

## Why this exists

AI agents are getting good at working with web pages, but today's options force an ugly trade: either the agent drives its own separate robot browser (no access to your real, logged-in world), or you install something with frightening powers over *every* tab you have open.

Chrome Tab Remote takes a third path, built on one conviction: **trust is the product.** You point at a single tab and say "this one". The agent can then read that tab — and only that tab — until the grant expires, the tab navigates somewhere else, or you hit Revoke. Everything the agent does is written to an audit trail you can inspect.

The goal is an extension so small, so boring, and so reviewable that a security-conscious company could actually approve it. No tracking, no data collection, no cloud service, no AI inside the extension — just a strict, visible consent boundary between your browser and whatever agent you connect.

## What it does (and refuses to do)

- **You grant, it observes.** One click in the side panel grants read access to the current tab for 30 minutes. Chrome itself asks for your confirmation for that one website — never "all sites".
- **The grant is pinned.** If the tab navigates to a different website, access is automatically suspended until you explicitly re-confirm — the panel shows you exactly which site you'd be re-approving.
- **Revocation is instant.** One click, or just close the tab. Expiry is automatic.
- **Observe-only.** This version cannot click, type, or change anything. Passwords are always redacted from what the agent sees.
- **Everything is audited.** Every grant, every read, every revocation — visible live in the side panel and appended to a local log file (`~/.chrome-tab-remote/audit.jsonl`).
- **No agent included, on purpose.** The tab is exposed through [MCP](https://modelcontextprotocol.io), the open standard for agent↔tool connections. Any MCP-capable agent (Claude Code, custom tooling, a plain CLI) can be the "brain" — this project only guards the door.

## How it works

![Architecture](./docs/solution-architecture.svg)

Chrome extension (your consent UI + enforcement) → native messaging → a small local helper process → MCP server on `http://127.0.0.1:8917/mcp` (localhost only, DNS-rebinding protected). Design details and roadmap: [plan.md](./plan.md).

## Try it yourself — manual test walkthrough

Prerequisites: Node 22+, Google Chrome, macOS (installer script; other OSes need a manual native-host manifest).

### 1. Build and install

```bash
npm install
npm run build
```

1. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, select `packages/extension/dist`. Copy the extension ID from the card.
2. Register the local helper so Chrome may launch it:
   ```bash
   node packages/host/scripts/install-native-host.mjs <extension-id>
   ```
3. Reload the extension once (↻ on the card).

### 2. Grant a tab

1. Open any normal website and click the **Chrome Tab Remote** toolbar icon — the side panel opens.
2. Check the panel shows **Native host: connected**.
3. Click **"Grant observe access (30 min)"** and accept Chrome's permission prompt for that site.
4. You should see an **Active grant** card with the site, a countdown, and a Revoke button.

### 3. Read the tab through MCP

Quickest — the bundled smoke test (lists grants, snapshots the tab, reads text from it):

```bash
node packages/host/scripts/smoke-mcp.mjs
```

Or interactively from the CLI with [mcporter](https://github.com/steipete/mcporter):

```bash
npx -y mcporter list http://127.0.0.1:8917/mcp --allow-http
npx -y mcporter call http://127.0.0.1:8917/mcp --tool list_grants --allow-http
npx -y mcporter call http://127.0.0.1:8917/mcp --tool tab_snapshot --allow-http
npx -y mcporter call http://127.0.0.1:8917/mcp --tool tab_snapshot filter:interactive --allow-http
npx -y mcporter call http://127.0.0.1:8917/mcp --tool tab_read ref:n1 --allow-http
```

There is at most one grant, so `grantId` is optional everywhere. The snapshot comes back as compact indented text — one line per element with a ref (`n1`), role, name, and link URL; `filter:interactive` narrows it to controls and headings. Pass a ref to `tab_read` for the full text of one element.

Or hand the tab to a real agent:

```bash
claude mcp add --transport http tab-remote http://127.0.0.1:8917/mcp
# then, in a Claude Code session: "Using the tab-remote tools, summarize my granted tab."
```

### 4. Verify the trust boundary (the important part)

| Do this | Expect this |
|---|---|
| Navigate the granted tab to another website | Grant flips to **suspended**; tool calls fail with `grant_suspended` |
| Click **Re-confirm for <site>** | Panel shows the exact new site before you approve; access resumes |
| Click **Revoke** (or close the tab) | Tool calls fail with `no_grant`; Chrome's site permission is dropped again |
| Wait out the 30 minutes | Tool calls fail with `grant_expired` |
| Snapshot a page with a password field | The password value reads `[redacted]` |
| Check `~/.chrome-tab-remote/audit.jsonl` | One line per grant event and per tool call, with timestamps |

If any of those don't hold, that's a bug — please report it.

## Current status & known gaps

Stage 1 (observe-only) — implemented, unit-tested (146 tests) and verified end-to-end against a real tab on 2026-08-02. Honest gaps, tracked in [PROJECT_OVERVIEW.md](./PROJECT_OVERVIEW.md):

- The local MCP endpoint has **no authentication yet** — other processes on *your own machine* could read the granted tab while a grant is active. Localhost-only + DNS-rebinding protection are in place; token auth is the first item of the next stage.
- Helper must run from this repo (no packaged binary yet); installer is macOS-only.
- Acting on pages (click/type, always behind an explicit approval step) is designed but intentionally **not built yet** — see the trust ladder in [plan.md](./plan.md).

## For developers

```bash
./precommit.sh   # typecheck + lint + 146 tests + dependency audit
```

Workspaces: `packages/shared` (zod protocol schemas — canonical), `packages/extension` (MV3, vanilla TypeScript, no frameworks), `packages/host` (native-messaging bridge + MCP server). Uninstall the helper with `node packages/host/scripts/install-native-host.mjs --uninstall`.
