# PROJECT_OVERVIEW — chrome-tab-remote

> as-of: 2026-08-04 · phase: **product behavior implemented and live-verified (Chrome + Brave); source-release ready, Chrome Web Store publication planning active; 231 tests**

## Current state

- **Stage 1 implemented** per `plan.md`: npm-workspaces monorepo (`packages/shared` zod contracts, `packages/extension` MV3, `packages/host` native-messaging bridge + MCP server on `127.0.0.1:8917`). At the 2026-08-02 milestone: 146 unit tests and `./precommit.sh` (typecheck + lint + test + audit) green, builds verified. Current audit status is recorded under Chrome Web Store blockers below. Human-first `README.md` with manual-test walkthrough.
- **Agent-ergonomics package (2026-08-02, benchmarked against Vercel agent-browser):** `tab_snapshot` `filter: interactive|full`; link `href`s (http/https, capped 300); compact indented-text MCP output via shared `renderSnapshot` (replaces JSON tree — smoke script updated to parse it); optional `grantId` defaulting to the single grant (resolved in the extension router, audited with the resolved id); per-error-code recovery instructions (`ERROR_RECOVERY`) appended to MCP errors; workflow-teaching tool descriptions. Polish round after live review: truncated names/hrefs carry a trailing `…` marker, and nameless interactive elements fall back to placeholder / inner img alt / title. Format alignment: ALL tool results are prose-shaped per the AGENTS.md principle — `tab_read` plain text, `list_grants` one line per grant with derived expiry minutes (empty list → recovery instruction). Deferred (ranked in `plan.md` §2.2): `tab_find`, snapshot ids/`stale_ref`, subtree scoping, `wait_for`/diffs; **Stage 2 prerequisite noted: expose `<select>` options before building `select(ref, value)`.**
- Multi-agent review ran (security / correctness / quality lenses); 8 confirmed findings fixed, incl. DNS-rebinding protection on the MCP endpoint, informed re-confirm (origin shown to user), alarm-based native-port reconnect (MV3 SW lifetime), oversized-frame desync handling. 16 lower-severity findings were **not** verified/fixed (capped) — candidates for a second review round.
- Design in `plan.md` (approved 2026-08-02); idea in `IDEA.md`; research in `RESEARCH.md`; reference analysis in `docs/chrome-tracker-takeaways.md`; canonical Chrome Web Store path in `docs/cws-signed-publishing-plan.md` (planning only — no submission started).
- Known limitations: **MCP endpoint has no authentication** — any local process can reach `127.0.0.1:8917` (DNS-rebinding protection exists; token auth is the top Stage 2 hardening item); host must run in-repo (no single binary yet); install script macOS-only; content-script bundle ~135 kB (zod via shared barrel).

## Current state (Stage 2, 2026-08-02)

- **Stage 2 implemented per `REQUIREMENTS.md` §7**: 'act' grants (side-panel checkbox), `tab_click`/`tab_fill`/`tab_select` on snapshot refs, per-action approval gate in the side panel (110 s auto-deny, one at a time, post-approval grant re-validation), monotonic refs → `stale_ref` by construction (rejected before the user is asked), `<select>` options on combobox nodes, password-fill refusal, action audit events, prose action results, host per-call timeout (120 s for act tools). At the 2026-08-02 milestone: 193 tests, precommit green, built.
- New error codes: `stale_ref`, `invalid_target`, `observe_only`, `approval_denied`, `approval_timeout` — all with recovery texts.

## Assist package (2026-08-02, from "what would help user+agent" ideation)

- **Implemented (unit-tested, 222 tests; live verification pending reload):** approval notifications + red toolbar badge (T-1; fixes the 4-timeout pain), plan approval with single-action unification (C-10, `tab_plan`, frozen steps, honest partial failure), post-action settle + embedded fresh snapshot with honest `settled/still-changing/interrupted` confidence (C-11, no auto-retry of plans), `request_grant` (T-2, agent asks / user picks the tab), `tab_find` (O-9). New extension icon (generated PNG, also used by notifications); manifest gains `notifications` permission and updated description.
- **Live-verified 2026-08-02:** 2-step `tab_plan` approved as one card (screenshot: `docs/screenshots/side-panel-tab-scoped-approval.png`, embedded in README); `interrupted` honesty path (click navigated mid-plan → unknown-steps warning + fresh snapshot); `settled` path (fill → settled + inline snapshot); `request_grant` full round trip (revoke → agent asks with reason → user grants → call returns grant); `tab_find` with fresh-refs warning. **User decision: system notifications are best-effort** (macOS suppresses them by default) — the red toolbar badge + panel card are the guaranteed attention signals (T-1 updated).

## External review round (2026-08-02, cg-task.sh)

- Ran `architecture-review`, `code-style`, `diff-review` (range 21f1d18..HEAD) — closing the "no independent review over Stage 2+" gap. Results: **diff-review clean** ("no material correctness or security flaws", full C-*/T-* traceability). `security-assessment` is unusable: the backing model (gemini-3.6-flash) refuses security framing — run with a different model if needed.
- 7 accepted findings implemented + 1 self-found (agent-facing list_grants text still claimed "observe-only"): dedicated `busy` error code (replaces overloaded approval_timeout/no_grant), panel refresh guard against SW-restart rejections, SW tab-listener error logging, shared `originOf` + extracted `findNodes` (now unit-tested), host JSONL rotation at 10 MB (one previous generation), stale texts fixed. Rejected: splitting `routeActTool` (linear gate sequence is deliberately one block). Deferred: cross-platform installer (E-4). Re-review of the fix batch: clean. 230 tests.
- Review outputs land in `cg-task-result-*.md` (gitignored).

## Next actions

1. ✅ Live E2E act test passed 2026-08-02: approve→real click (navigated /Montag→/Bauernliste), deny→approval_denied untouched, 4× timeout auto-deny, stale-world recovery after action, audit chain complete. Learning: approval needs the side panel visible — mcporter needs `--timeout 130000` (its 60 s default < our 110 s approval window).
2. **Tab-scoped panel (G-9) implemented 2026-08-02** after user feedback ("panel looked like heise.de was granted"): panel renders relative to the active tab — share-status line, "granted on another tab" card (go-to-tab/revoke), explicit Replace button, per-tab audit view (entries stamped with `tabId`, "show all" toggle, JSONL stays global), audit-lag fix (panel push on every entry), approval card gains go-to-tab. 194 tests. Needs extension reload + visual check by user.
2a. **Freaky mode (C-9) implemented 2026-08-02** (user request; UI name 'Freaky', code `autoApprove`): live-toggleable per-grant auto-approve on the grant card, gate reads current grant state per action, dies with the grant, audited (`auto_approve_enabled/disabled`, `action_auto_approved`), announced to the agent via list_grants. 198 tests.
3. ✅ All work committed (14+ commits on main). Remaining observe burn-down rows (suspension/re-confirm, tab-close teardown, `[empty]` marker, X-5 expired rendering) fold into any future manual session via README §5.
4. Cosmetic follow-up: duplicate `native_connected` audit entries (~5× within a second) suggest reconnect churn — investigate native-port connect path.
5. Optional: second review round over the 16 unverified findings; Stage 3 candidates per plan.md (batch approval, persistent grants) and REQUIREMENTS later-candidates (`tab_find`, subtree scoping, `wait_for`). **User decision 2026-08-02: MCP token auth deprioritized** (fully local deployment; localhost + DNS-rebinding protection accepted for now).

## Open publication decisions

- Canonical source: `docs/cws-signed-publishing-plan.md` → **Current position** and **Blocker register**; do not duplicate evolving details here.
- Next human decisions are deliberately batched: final Store-facing name, privacy-policy host, minimum reviewer-helper path, publisher ownership/recovery, and later signing-key custody.
- Public Chrome Web Store v1 is selected; enterprise certification/native-host productisation remains a separate track.

## Chrome Web Store blockers (planning state, 2026-08-04)

- `./precommit.sh` is red because the dependency audit reports the Hono ReDoS advisory; 231 tests, typecheck, and lint remain green.
- Deterministic bootstrap/final Store packaging and verifier, unified versioning, compliant listing assets, public privacy policy, reviewer-safe helper distribution, required publisher-profile/contact verification, permanent Store ID alignment, exact final-package upload, deferred/manual publication, and future signing-key custody/informed opt-in remain undone.
- Execution order, evidence gates, automation boundaries, and minimal human batches are canonical in `docs/cws-signed-publishing-plan.md`.
- No account, dashboard item, signing key, submission, or publication has been created by this planning work.

## Doc map

`AGENTS.md` (durable rules) · `REQUIREMENTS.md` (canonical numbered requirements, status + traceability) · `IDEA.md` (north star) · `RESEARCH.md` (dated research log) · `docs/cws-signed-publishing-plan.md` (canonical Store release plan) · `docs/chrome-tracker-takeaways.md` (+ `.d2`/`.svg` diagram)
