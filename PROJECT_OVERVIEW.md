# PROJECT_OVERVIEW — chrome-tab-remote

> as-of: 2026-08-02 · phase: **Stage 2 (act: click/fill/select + approval gate) implemented, 193 tests — awaiting Chrome reload + live E2E act test**

## Current state

- **Stage 1 implemented** per `plan.md`: npm-workspaces monorepo (`packages/shared` zod contracts, `packages/extension` MV3, `packages/host` native-messaging bridge + MCP server on `127.0.0.1:8917`). 146 unit tests, `./precommit.sh` (typecheck + lint + test + audit) green, builds verified. Human-first `README.md` with manual-test walkthrough.
- **Agent-ergonomics package (2026-08-02, benchmarked against Vercel agent-browser):** `tab_snapshot` `filter: interactive|full`; link `href`s (http/https, capped 300); compact indented-text MCP output via shared `renderSnapshot` (replaces JSON tree — smoke script updated to parse it); optional `grantId` defaulting to the single grant (resolved in the extension router, audited with the resolved id); per-error-code recovery instructions (`ERROR_RECOVERY`) appended to MCP errors; workflow-teaching tool descriptions. Polish round after live review: truncated names/hrefs carry a trailing `…` marker, and nameless interactive elements fall back to placeholder / inner img alt / title. Format alignment: ALL tool results are prose-shaped per the AGENTS.md principle — `tab_read` plain text, `list_grants` one line per grant with derived expiry minutes (empty list → recovery instruction). Deferred (ranked in `plan.md` §2.2): `tab_find`, snapshot ids/`stale_ref`, subtree scoping, `wait_for`/diffs; **Stage 2 prerequisite noted: expose `<select>` options before building `select(ref, value)`.**
- Multi-agent review ran (security / correctness / quality lenses); 8 confirmed findings fixed, incl. DNS-rebinding protection on the MCP endpoint, informed re-confirm (origin shown to user), alarm-based native-port reconnect (MV3 SW lifetime), oversized-frame desync handling. 16 lower-severity findings were **not** verified/fixed (capped) — candidates for a second review round.
- Design in `plan.md` (approved 2026-08-02); idea in `IDEA.md`; research in `RESEARCH.md`; reference analysis in `docs/chrome-tracker-takeaways.md`.
- Known limitations: **MCP endpoint has no authentication** — any local process can reach `127.0.0.1:8917` (DNS-rebinding protection exists; token auth is the top Stage 2 hardening item); host must run in-repo (no single binary yet); install script macOS-only; content-script bundle ~135 kB (zod via shared barrel).

## Current state (Stage 2, 2026-08-02)

- **Stage 2 implemented per `REQUIREMENTS.md` §7** (uncommitted): 'act' grants (side-panel checkbox), `tab_click`/`tab_fill`/`tab_select` on snapshot refs, per-action approval gate in the side panel (110 s auto-deny, one at a time, post-approval grant re-validation), monotonic refs → `stale_ref` by construction (rejected before the user is asked), `<select>` options on combobox nodes, password-fill refusal, action audit events, prose action results, host per-call timeout (120 s for act tools). 193 tests, precommit green, built.
- New error codes: `stale_ref`, `invalid_target`, `observe_only`, `approval_denied`, `approval_timeout` — all with recovery texts.

## Next actions

1. ✅ Live E2E act test passed 2026-08-02: approve→real click (navigated /Montag→/Bauernliste), deny→approval_denied untouched, 4× timeout auto-deny, stale-world recovery after action, audit chain complete. Learning: approval needs the side panel visible — mcporter needs `--timeout 130000` (its 60 s default < our 110 s approval window).
2. **Tab-scoped panel (G-9) implemented 2026-08-02** after user feedback ("panel looked like heise.de was granted"): panel renders relative to the active tab — share-status line, "granted on another tab" card (go-to-tab/revoke), explicit Replace button, per-tab audit view (entries stamped with `tabId`, "show all" toggle, JSONL stays global), audit-lag fix (panel push on every entry), approval card gains go-to-tab. 194 tests. Needs extension reload + visual check by user.
2a. **Freaky mode (C-9) implemented 2026-08-02** (user request; UI name 'Freaky', code `autoApprove`): live-toggleable per-grant auto-approve on the grant card, gate reads current grant state per action, dies with the grant, audited (`auto_approve_enabled/disabled`, `action_auto_approved`), announced to the agent via list_grants. 198 tests.
3. Commit Stage 2 + G-9 + Freaky mode (user decision — uncommitted). Remaining observe burn-down rows (suspension/re-confirm, tab-close teardown, `[empty]` marker, X-5 expired rendering) fold into any future manual session via README §5.
4. Cosmetic follow-up: duplicate `native_connected` audit entries (~5× within a second) suggest reconnect churn — investigate native-port connect path.
5. Optional: second review round over the 16 unverified findings; Stage 3 candidates per plan.md (batch approval, persistent grants) and REQUIREMENTS later-candidates (`tab_find`, subtree scoping, `wait_for`). **User decision 2026-08-02: MCP token auth deprioritized** (fully local deployment; localhost + DNS-rebinding protection accepted for now).

## Open questions

- Backend: local-only, self-hosted, or SaaS? (drives auth, secrets, enterprise story)
- Which concrete actions must the MVP support (read/extract vs click/type/navigate)?
- Mandatory enterprise controls: allowlists, audit log, SSO, data residency, DLP?
- Reuse an OSS base (nanobrowser closest) or build minimal from scratch for auditability?
- Distribution: Chrome Web Store vs enterprise policy install — affects permission strategy.

## Blockers

- None external; next step is the MVP RFC (decision work, not code).

## Doc map

`AGENTS.md` (durable rules) · `REQUIREMENTS.md` (canonical numbered requirements, status + traceability) · `IDEA.md` (north star) · `RESEARCH.md` (dated research log) · `docs/chrome-tracker-takeaways.md` (+ `.d2`/`.svg` diagram)
