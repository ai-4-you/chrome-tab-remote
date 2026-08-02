# PROJECT_OVERVIEW — chrome-tab-remote

> as-of: 2026-08-02 · phase: **Stage 1 + agent-ergonomics package implemented — awaiting Chrome reload for live re-verify**

## Current state

- **Stage 1 implemented** per `plan.md`: npm-workspaces monorepo (`packages/shared` zod contracts, `packages/extension` MV3, `packages/host` native-messaging bridge + MCP server on `127.0.0.1:8917`). 146 unit tests, `./precommit.sh` (typecheck + lint + test + audit) green, builds verified. Human-first `README.md` with manual-test walkthrough.
- **Agent-ergonomics package (2026-08-02, benchmarked against Vercel agent-browser):** `tab_snapshot` `filter: interactive|full`; link `href`s (http/https, capped 300); compact indented-text MCP output via shared `renderSnapshot` (replaces JSON tree — smoke script updated to parse it); optional `grantId` defaulting to the single grant (resolved in the extension router, audited with the resolved id); per-error-code recovery instructions (`ERROR_RECOVERY`) appended to MCP errors; workflow-teaching tool descriptions. Polish round after live review: truncated names/hrefs carry a trailing `…` marker, and nameless interactive elements fall back to placeholder / inner img alt / title. Deferred (ranked in `plan.md` §2.2): `tab_find`, snapshot ids/`stale_ref`, subtree scoping, `wait_for`/diffs; **Stage 2 prerequisite noted: expose `<select>` options before building `select(ref, value)`.**
- Multi-agent review ran (security / correctness / quality lenses); 8 confirmed findings fixed, incl. DNS-rebinding protection on the MCP endpoint, informed re-confirm (origin shown to user), alarm-based native-port reconnect (MV3 SW lifetime), oversized-frame desync handling. 16 lower-severity findings were **not** verified/fixed (capped) — candidates for a second review round.
- Design in `plan.md` (approved 2026-08-02); idea in `IDEA.md`; research in `RESEARCH.md`; reference analysis in `docs/chrome-tracker-takeaways.md`.
- Known limitations: **MCP endpoint has no authentication** — any local process can reach `127.0.0.1:8917` (DNS-rebinding protection exists; token auth is the top Stage 2 hardening item); host must run in-repo (no single binary yet); install script macOS-only; content-script bundle ~135 kB (zod via shared barrel).

## Next actions

1. Live re-verify the ergonomics package (user must reload the extension in `chrome://extensions` so Chrome respawns the host with the new build), then commit (user decision — README rewrite + ergonomics package are uncommitted).
1a. Prior E2E smoke test passed 2026-08-02: grant on a real tab → `list_grants`/`tab_snapshot`/`tab_read` via MCP, audit JSONL confirmed. Fix landed during testing: runtime per-origin permission request in the grant gesture (`optional_host_permissions`) + teardown, since `activeTab` doesn't cover side-panel clicks.
2. Cosmetic follow-up: duplicate `native_connected` audit entries (~5× within a second) suggest reconnect churn — investigate native-port connect path.
3. Optional: second review round over the 16 unverified findings.
4. Then Stage 2 per `plan.md`: actions + approval gate; first hardening item is MCP token auth.

## Open questions

- Backend: local-only, self-hosted, or SaaS? (drives auth, secrets, enterprise story)
- Which concrete actions must the MVP support (read/extract vs click/type/navigate)?
- Mandatory enterprise controls: allowlists, audit log, SSO, data residency, DLP?
- Reuse an OSS base (nanobrowser closest) or build minimal from scratch for auditability?
- Distribution: Chrome Web Store vs enterprise policy install — affects permission strategy.

## Blockers

- None external; next step is the MVP RFC (decision work, not code).

## Doc map

`AGENTS.md` (durable rules) · `IDEA.md` (north star) · `RESEARCH.md` (dated research log) · `docs/chrome-tracker-takeaways.md` (+ `.d2`/`.svg` diagram)
