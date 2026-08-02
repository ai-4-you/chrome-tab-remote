# PROJECT_OVERVIEW — chrome-tab-remote

> as-of: 2026-08-02 · phase: **Stage 1 (observe-only MVP) implemented and E2E-verified in real Chrome — uncommitted**

## Current state

- **Stage 1 implemented** per `plan.md`: npm-workspaces monorepo (`packages/shared` zod contracts, `packages/extension` MV3, `packages/host` native-messaging bridge + MCP server on `127.0.0.1:8917`). 128 unit tests, `./precommit.sh` (typecheck + lint + test + audit) green, builds verified. Quickstart in `README.md`.
- Multi-agent review ran (security / correctness / quality lenses); 8 confirmed findings fixed, incl. DNS-rebinding protection on the MCP endpoint, informed re-confirm (origin shown to user), alarm-based native-port reconnect (MV3 SW lifetime), oversized-frame desync handling. 16 lower-severity findings were **not** verified/fixed (capped) — candidates for a second review round.
- Design in `plan.md` (approved 2026-08-02); idea in `IDEA.md`; research in `RESEARCH.md`; reference analysis in `docs/chrome-tracker-takeaways.md`.
- Known limitations: **MCP endpoint has no authentication** — any local process can reach `127.0.0.1:8917` (DNS-rebinding protection exists; token auth is the top Stage 2 hardening item); host must run in-repo (no single binary yet); install script macOS-only; content-script bundle ~135 kB (zod via shared barrel).

## Next actions

1. Commit the Stage 1 checkpoint (user decision). E2E smoke test passed 2026-08-02: grant on a real tab → `list_grants`/`tab_snapshot`/`tab_read` via MCP, audit JSONL confirmed. Fix landed during testing: runtime per-origin permission request in the grant gesture (`optional_host_permissions`) + teardown, since `activeTab` doesn't cover side-panel clicks.
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
