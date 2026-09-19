# PROJECT_OVERVIEW — chrome-tab-remote

> as-of: 2026-09-19 · phase: **product behavior implemented and live-verified (Chrome + Brave); source-release ready, Chrome Web Store publication planning active; 252 tests**

## Current state

- **Response-efficiency package (2026-09-19, live-verified in Brave MCP `:8918`):** successful actions and plans return an honest dispatch receipt (executed steps, first failure if any, and settle state), never an embedded snapshot; callers explicitly observe afterward. `tab_find` searches the latest snapshot without re-capturing or invalidating its refs; `tab_read_many` returns 1–100 requested latest-snapshot refs in order, with per-ref labels and the existing redaction/grant rules. On a granted Bluesky thread, a pre-find ref remained readable; 12 reply reads completed in 1 batch call instead of 12 individual calls (2,448 B vs 2,331 B because labels add 117 B); and a user-approved share-menu click returned a 189 B receipt followed by an explicit snapshot that showed the three menu items. Build, typecheck, lint, 252 tests, and production dependency audit passed (the lockfile pins patched `qs` 6.16.0).
- **Consent-gated viewport screenshots (2026-08-08, live-verified in Brave MCP `:8918`):** `tab_screenshot_viewport` is default-off at grant time and returns a bounded JPEG MCP image only when the granted tab is active—never focus-stealing, scrolling, full-page, or persisted. The user must click the explicit Chrome Tab Remote toolbar action on the screenshot-enabled granted tab **after** granting it; that action establishes `activeTab` for capture. Two MCP JPEG captures of Know-AI’s visible Knowledge viewport succeeded (138,457 B and 181,929 B), and the latter was visually inspected for tab/viewport correctness. The router revalidates grant/origin, caps base64 at 600 KiB, and audits the call. Chrome exposes capture per window, not per tab; the post-capture check cannot prove a tab did not switch away and back entirely during the asynchronous call.
- **Stage 1 implemented** per `plan.md`: npm-workspaces monorepo (`packages/shared` zod contracts, `packages/extension` MV3, `packages/host` native-messaging bridge + MCP server on `127.0.0.1:8917`). At the 2026-08-02 milestone: 146 unit tests and `./precommit.sh` (typecheck + lint + test + audit) green, builds verified. Current audit status is recorded under Chrome Web Store blockers below. Human-first `README.md` with manual-test walkthrough.
- **Agent-ergonomics package (2026-08-02, benchmarked against Vercel agent-browser):** `tab_snapshot` `filter: interactive|full`; link `href`s (http/https, capped 300); compact indented-text MCP output via shared `renderSnapshot` (replaces JSON tree — smoke script updated to parse it); optional `grantId` defaulting to the single grant (resolved in the extension router, audited with the resolved id); per-error-code recovery instructions (`ERROR_RECOVERY`) appended to MCP errors; workflow-teaching tool descriptions. Polish round after live review: truncated names/hrefs carry a trailing `…` marker, and nameless interactive elements fall back to placeholder / inner img alt / title. Format alignment: ALL tool results are prose-shaped per the AGENTS.md principle — `tab_read` plain text, `list_grants` one line per grant with derived expiry minutes (empty list → recovery instruction). Deferred (ranked in `plan.md` §2.2): `tab_find`, snapshot ids/`stale_ref`, subtree scoping, `wait_for`/diffs; **Stage 2 prerequisite noted: expose `<select>` options before building `select(ref, value)`.**
- Multi-agent review ran (security / correctness / quality lenses); 8 confirmed findings fixed, incl. DNS-rebinding protection on the MCP endpoint, informed re-confirm (origin shown to user), alarm-based native-port reconnect (MV3 SW lifetime), oversized-frame desync handling. 16 lower-severity findings were **not** verified/fixed (capped) — candidates for a second review round.
- Design in `plan.md` (approved 2026-08-02); idea in `IDEA.md`; research in `RESEARCH.md`; reference analysis in `docs/chrome-tracker-takeaways.md`; canonical Chrome Web Store path in `docs/cws-signed-publishing-plan.md` (planning only — no submission started).
- Native-host installer hardening (2026-08-26): when invoked from a Homebrew Node Cellar path, the generated dispatcher now uses that formula’s stable `opt/.../bin/node` symlink instead. This prevents Homebrew cleanup from leaving the browser host launcher pointing at a removed Node version; regression-covered.
- Known limitations: **MCP endpoint has no authentication** — any local process can reach `127.0.0.1:8917` (DNS-rebinding protection exists; token auth is the top Stage 2 hardening item); host must run in-repo (no single binary yet); install script macOS-only; content-script bundle ~135 kB (zod via shared barrel).

## Current state (Stage 2, 2026-08-02)

- **Stage 2 implemented per `REQUIREMENTS.md` §7**: 'act' grants (side-panel checkbox), `tab_click`/`tab_fill`/`tab_select` on snapshot refs, per-action approval gate in the side panel (110 s auto-deny, one at a time, post-approval grant re-validation), monotonic refs → `stale_ref` by construction (rejected before the user is asked), `<select>` options on combobox nodes, password-fill refusal, action audit events, prose action results, host per-call timeout (120 s for act tools). At the 2026-08-02 milestone: 193 tests, precommit green, built.
- New error codes: `stale_ref`, `invalid_target`, `observe_only`, `approval_denied`, `approval_timeout` — all with recovery texts.

## Assist package (2026-08-02, from "what would help user+agent" ideation)

- **Implemented (unit-tested, 222 tests; later live-verified):** approval notifications + red toolbar badge (T-1; fixes the 4-timeout pain), plan approval with single-action unification (C-10, `tab_plan`, frozen steps, honest partial failure), post-action settle with honest `settled/still-changing/interrupted` confidence (C-11, now a dispatch receipt requiring explicit observation; no auto-retry of plans), `request_grant` (T-2, agent asks / user picks the tab), `tab_find` (O-9). New extension icon (generated PNG, also used by notifications); manifest gains `notifications` permission and updated description.
- **Live-verified 2026-08-02 (with receipt/find semantics re-verified 2026-09-19 above):** 2-step `tab_plan` approved as one card (screenshot: `docs/screenshots/side-panel-tab-scoped-approval.png`, embedded in README); `interrupted` honesty path (click navigated mid-plan → unknown-steps warning and explicit follow-up observation); `settled` path (fill → settled receipt and explicit observation); `request_grant` full round trip (revoke → agent asks with reason → user grants → call returns grant); `tab_find` snapshot-backed. **User decision: system notifications are best-effort** (macOS suppresses them by default) — the red toolbar badge + panel card are the guaranteed attention signals (T-1 updated).

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

## Chrome Web Store (submitted for review, 2026-08-26)

- **Status: Under Google review.** Item "Chrome Tab Remote" (ID `pkmcmaegiobodpogiankgdnghfejhpoh`) submitted at v0.1.0 with deferred publishing.
- H1 (account) and H2a (upload + submit) complete. Publisher ID `32d2830d-5080-4c1f-a200-911687d5b802`.
- Listing: 3× 640×400 screenshots, description, category, privacy justifications (from `docs/cws-privacy-form.md`), no remote code, data-usage = Website content only.
- Dependency refresh 2026-08-26: eslint 10.9.1, vitest 4.1.11 (vite 8.2.2 pulled transitively). Precommit green: 244 tests, typecheck, lint, audit 0 vulns.
- **While under review — action items:**
  1. Monitor publisher email + dashboard for review outcome (days to weeks).
  2. H2b (manual publish): on approval → verify staged version/listing → Publish before 30-day expiry.
  3. H3 (Verified Uploads): after first publication → signing-key custody → opt-in (irreversible; Stage 8).
  4. Store key swap: manifest still has dev key. Once live, confirm Store ID matches native-host `allowed_origins`; if different, update manifest key + bump version.
  5. Privacy policy URL: confirm the URL in the dashboard resolves and matches policy content.
  6. 440×280 promo tile: if CWS requires post-approval, generate and upload.
  7. 2-Step Verification: confirm enabled on Google account before H2b publish.
- Execution order and gates: `docs/cws-signed-publishing-plan.md`.

## Doc map

`AGENTS.md` (durable rules) · `REQUIREMENTS.md` (canonical numbered requirements, status + traceability) · `IDEA.md` (north star) · `RESEARCH.md` (dated research log) · `docs/macos-native-host-delivery.md` (macOS-first helper productisation) · `docs/native-host-trust-status.md` (verified trust state and limits) · `docs/cws-signed-publishing-plan.md` (canonical Store release plan) · `docs/chrome-tracker-takeaways.md` (+ `.d2`/`.svg` diagram)
