# C-12: `tab_navigate(url)` — Allow Navigate capability

**Status:** REVIEWED v3.1 (2026-09-28). v2 findings (Greta peer + Rourke red team) applied;
v3 cross-origin pivot (user decision 2026-09-28) + §2.7 origin-transition consent rule;
v3.1 folds in Vera's red team on the delta (§9). **§2.7 APPROVED by user 2026-09-28**
(amends G-3 for ALL cross-origin transitions). **READY FOR PHASE 2.**
**Supersedes:** the `navigate deferred to a later slice` note in C-2.

## 1. Goal and scope

Add a **default-off** grant capability **Allow Navigate** and a tool **`tab_navigate(url)`**
that navigates the granted tab to a URL via `chrome.tabs.update`, modelled on the
existing `allowViewportScreenshot` capability.

**In scope:** grant flag, panel checkbox, router branch, approval rendering, receipt,
errors, host tool registration, the §2.7 origin-transition consent rule, tests,
REQUIREMENTS.md + PROJECT_OVERVIEW.md + README.

**Non-goals (do NOT touch):** manifest (no permission change — verified), multi-tab,
new native-host frames, scroll (already shipped, C-2a), content-script changes
(navigate is background-side only).

## 2. Design decisions (with rationale)

1. **Background-side branch, not a plan step.** Sibling branch in `routeToolCall` next
   to `tab_screenshot_viewport`; NOT a `PlanStepSchema` kind; NOT in `ACT_TOOL_NAMES`.
   It is ref-less, and navigation kills the content channel that would deliver a plan
   receipt.
2. **Any http(s) origin — two-tier semantics (user decision 2026-09-28).**
   - (a) **Same-origin destination:** grant stays active; normal receipt.
   - (b) **Cross-origin destination:** the navigation happens; the existing origin pin
     (G-3) **automatically suspends** the grant; the result carries
     `grantStatus: 'suspended'` and a Next step for re-consent.
   - **Per-domain re-ask is structural, not a design choice:** resuming on the new
     origin requires the existing **informed re-confirm** (panel shows the exact new
     origin; Chrome's per-site host-permission prompt fires at that user gesture —
     `chrome.permissions.request` is gesture-gated, so the agent can never obtain the
     new domain's permission itself). Cross-origin + auto-suspension + re-confirm is
     the "defensible, moderate-scrutiny" CWS posture (docs-verified 2026-09-28).
   - Honest limitation (red team F2, still holds): destination pages are untrusted;
     **the full destination URL is the unit of consent** — verbatim on the card AND in
     the audit, never just the origin.
3. **Freaky mode (C-9) applies to same-origin navigate only.** A cross-origin navigate
   **ALWAYS gets the explicit boundary card** (§3.4): Freaky is about actions WITHIN
   the consent boundary; crossing to a new origin is a boundary event that always
   pauses (advisor-confirmed; consistent with C-9's "Freaky dies with the grant").
4. **Gate order:** `mode === 'act'` AND `allowNavigate === true` → URL validation →
   serialization → approval gate (Freaky reads CURRENT grant state, C-9; bypass only
   for same-origin destinations) → re-validation → execute → post-load re-validation.
   Re-validation on **BOTH** branches (v2 M5).
5. **No retry** after `chrome.tabs.update` (C-11).
6. **One navigate in flight per grant** → `busy` (v2 F3).
7. **Origin-transition consent rule (v3 — amends G-3; APPROVED by user 2026-09-28).**
   When a re-confirm re-pins a suspended grant to a **different** origin than before,
   the high-risk capability flags **reset**: `autoApprove → false`,
   `allowViewportScreenshot → false`; `mode` and `allowNavigate` persist. Re-confirm to
   the SAME origin (e.g. recovering from a `chrome-error` suspension) does NOT reset.
   Rationale: click-fatigued re-confirms must not silently carry YOLO + pixel-exposure
   into a new (possibly sensitive) domain; consistent with C-9. This rule applies to
   **all** cross-origin transitions (manual link clicks, act-tool navigations,
   `tab_navigate`) — one boring rule, not a navigate special case.
   **Enforcement (v3.1, Vera F1):** the reset is force-set AT RE-PIN by `reconfirmByUser`
   (new origin ⇒ `autoApprove: false, allowViewportScreenshot: false`, regardless of the
   currently stored flags) — a stale toggle state can never survive the transition.
   Panel behaviour: the Freaky toggle is DISABLED while the grant is suspended (today
   sidepanel.ts:~186 only hides it for non-act grants — a suspended grant is still act,
   so the toggle stays live today; a re-click before re-confirm would look like it
   re-enables YOLO even though the re-pin forces it off).
   **Replace/mint (G-9) is out of scope by construction (Vera F3):** Replace mints a
   FRESH grant where every capability is re-selected from strict defaults, so both
   paths to a new origin end in explicit capability consent; the §2.7 reset governs
   the re-confirm path only.
   The re-confirm card states the reset as a fact, danger-styled, ABOVE the confirm
   button (Vera F6 — not fine print): "Auto-approve and screenshots are now OFF on
   this origin."

## 3. Behaviour

### 3.1 URL validation (all before the user is asked)
Raw-string pre-checks (belt-and-braces, F4):
- reject if the raw string contains a backslash or a control character (U+0000–U+001F);
- must be a string, non-empty, length ≤ 2048.
Parse and check (`u = new URL(url)`):
- parse failure → `navigate_bad_url` ("Unparseable URL …").
- `u.protocol` must be exactly `http:` or `https:` (rejects `javascript:`, `file:`,
  `data:`, `blob:`, `chrome:`, `view-source:`).
- reject if `u.username !== '' || u.password !== ''` (credential-bearing URLs).
- **No origin restriction** (v3): any http(s) origin is a legal destination; the
  same-origin vs cross-origin distinction only affects the receipt (§3.5) and the
  approval path (§3.4).
Normalization delegated to `URL` (origin/hostname properties, never raw string
comparison); test battery pins it (port, host case, IPv6, trailing slash, `%2F` in
path, empty userinfo).

### 3.2 Capability gate
`grant.mode !== 'act' || grant.allowNavigate !== true` →
`navigate_not_allowed` with Next step: ask the user to enable "Allow Navigate" in the
side panel (act grants only).
In-flight serialize (decision 6) → `busy`.

### 3.3 Execution (order matters — v2 F1/F3/F5, M4/M5)
1. Re-validate via `validateGrantForCall` (BOTH branches).
2. Serialize check → `busy` if a navigate for this grant is in flight.
3. **Audit `navigate_dispatched`** (opId, requestedUrl, **crossOrigin flag**,
   autoApproved) BEFORE dispatch — the JSONL alone must answer "did it navigate?".
4. `chrome.tabs.update(tabId, { url })`.
5. Load-wait: one-shot `chrome.tabs.onUpdated` for this tabId,
   `changeInfo.status === 'complete'` (record observed `changeInfo.url`s = redirect
   chain), **30 s timeout** → `loadState: 'timeout'`. Cleanup invariant: exactly one
   of {complete, timeout} wins; listener AND timer removed on EVERY exit path.
   Tested invariant.
6. Post-load re-validation via `validateGrantForCall` (NOT raw `tabs.get` — raw get
   races the pin listener and lets the receipt overclaim).
   - tab gone → `grant_revoked`;
   - grant still active (same-origin, incl. same-origin redirect chain) → proceed;
   - grant suspended (cross-origin destination, off-origin redirect, or
     `chrome-error://`) → **ok result with `grantStatus: 'suspended'`** (the
     navigation really happened — that is the point) + Next step: "The grant for
     <old origin> is suspended. Ask the user to re-confirm the grant for
     <finalOrigin> in the side panel (or request_grant). High-risk capabilities are
     reset on the new origin (§2.7)." Never claim the session continues.
7. **Attribution:** `loadState: 'conflict'` when the final URL is unrelated to the
   requested URL — `finalUrl !== requestedUrl` AND `finalUrl` never observed as
   `changeInfo.url` during this call's wait (another navigation landed here).
   Non-success prose: "The tab now shows <finalUrl>, which this call did not load;
   take a snapshot to see where you are."
8. **Audit `navigate_completed`** (finalUrl, loadState, **grantStatus**, conflict
   note) on every terminal path. **Audit linking (v3.1, Vera F2):** both navigate
   events carry **grantId** (forensic join must not depend on timestamps); a
   navigate-caused suspension may name an INTERMEDIATE redirect origin in its detail
   while the re-confirm names the final one (Vera F4 — expected, document it); a
   navigate that suspends the grant still logs `tool_call ok: true` (the navigation
   succeeded — the boundary facts live in the suspend/re-confirm events); the
   `grant_reconfirmed` detail is PINNED to include the reset, e.g.
   `"re-pinned to https://b; reset autoApprove, allowViewportScreenshot"`.

### 3.4 Approval
- **Same-origin:** "Agent wants to navigate to `https://…`" (full URL verbatim,
  display-truncated at 400 chars). Freaky may bypass (§2.3).
- **Cross-origin:** the card MUST show the full URL **and** the boundary:
  "Agent wants to navigate to `<url>` — a DIFFERENT origin. This suspends the grant
  for `<current origin>`; the user must re-confirm on `<dest origin>` to continue."
  Freaky NEVER bypasses this card.
- Audit exactly like other act tools: `action_proposed`/`action_approved`/
  `action_denied`/`action_timeout`/`action_auto_approved` (tool = `tab_navigate`).
  Full re-validation after the approval wait (C-4).
- `ApprovalStep.kind` gains `'navigate'`; ripple: shared type, side-panel step
  renderer (background/index.ts ~69-72), notification summary.

### 3.5 Receipt (result shape — new `NavigateResultSchema`)
```
{ requestedUrl, finalUrl, loadState: 'complete' | 'timeout' | 'conflict',
  grantStatus: 'active' | 'suspended' }
```
MCP prose (X-2) examples:
- same-origin: `Navigated https://a/p → https://a/p2 (loaded). Snapshot refs are
  invalid — take a fresh tab_snapshot.`
- cross-origin: `Navigated to https://b/x (loaded) — a different origin. The grant for
  https://a is SUSPENDED. Ask the user to re-confirm the grant for https://b in the
  side panel; auto-approve and screenshots are reset there (§2.7).`
- `timeout`: "navigation dispatched; page still loading after 30 s. An immediate
  tab_snapshot may fail (tab_unreachable) while the channel re-injects — wait ~5 s,
  then tab_snapshot."
- `conflict`: see §3.3.7.
- `conflict` + suspended (user navigated to another origin during the load-wait —
  v3.1, Vera F7): "The tab now shows <finalUrl>, which this call did not load — and
  it is a different origin, so the grant is SUSPENDED. Ask the user to re-confirm for
  <finalOrigin>; auto-approve and screenshots reset there."
- final URL on a non-http(s) scheme (`chrome-error://`) → prose says the load failed
  ("tab is on a Chrome error page") alongside `grantStatus: 'suspended'`.
- Next step in EVERY success result: refs are invalid, call `tab_snapshot`.
- Next step in ALL navigate results: `tab_screenshot_viewport` may require the user
  to re-invoke the toolbar (activeTab persistence after same-origin navigation
  unverified — §7.4); cross-origin, it is off until re-confirm anyway (§2.7).
- Host: handler passes `NAVIGATE_TOOL_TIMEOUT_MS = 150_000` (budget: 110 s approval
  + 30 s load + margin; v2 M1 — 15 s default kills mid-approval-card).
- Host result handling mirrors `tab_screenshot_viewport`: safe-parse → prose primary
  + structured payload; parse failure falls back to `okResult(raw)`.

## 4. Edge cases (must be covered by tests or live checks)
1. Cross-origin destination → pin suspends → `grantStatus: 'suspended'`, honest
   Next step; re-confirm re-pins (§2.7 resets apply).
2. Cross-origin redirect chain (requested B, lands C): receipt shows finalUrl C,
   suspended; re-confirm re-pins to C.
3. Same-origin destination that redirects off-origin → suspended, honest (no
   "success" framing).
4. Destination fails to load (DNS/offline) → `chrome-error://` → suspended + error
   prose.
5. Grant expired/revoked/suspended during approval wait OR load-wait → re-validation
   (M5) / post-load `validateGrantForCall` (M4) fails closed.
6. 30 s timeout → `loadState: 'timeout'`, no retry, cleanup invariant holds.
7. Reload (navigate to current URL) → legal, same path.
8. Two navigates in flight (Freaky back-to-back) → second gets `busy`.
9. User-initiated navigation during the load-wait → `conflict`, never laundered.
10. MV3 SW death during load-wait → no false receipt: host times out with the
    audited-dispatch message; JSONL shows `navigate_dispatched` (F1; SW-startup
    reconciliation out of scope for v1).
11. Re-confirm on the new origin: Chrome's per-site permission prompt REJECTED →
    grant stays suspended, error surfaces gracefully (existing reconfirm path —
    verify, don't assume).
12. Re-confirm to the SAME origin (chrome-error recovery) → §2.7 does NOT reset.
13. Stale Freaky toggle during suspension (v3.1): toggle disabled in the panel;
    re-pin FORCE-sets autoApprove false even if stored true (regression test, Vera F1).
14. Manual cross-origin click → re-confirm → reset applies + danger-styled reset line
    visible on the card (rule is not navigate-special-cased, Vera F6).
15. Transient off-origin redirect hop B before final C: suspension detail names B,
    re-confirm re-pins to C; both audited (Vera F4).

## 5. Touchpoint checklist (verify each against the CURRENT tree — scroll commit
`639e8f1` touched several of these files)

| # | File | Change |
|---|------|--------|
| 1 | `packages/shared/src/grant.ts` | `allowNavigate: z.boolean().default(false)` beside `allowViewportScreenshot` |
| 2 | `packages/shared/src/messages.ts` | `tab_navigate` in `TOOL_NAMES` (NOT `ACT_TOOL_NAMES`); `NavigateResultSchema` (incl. `grantStatus`) |
| 3 | `packages/shared/src/errors.ts` | `navigate_not_allowed` + `navigate_bad_url`, dedicated recovery text each (X-3; do NOT reuse `invalid_target`) |
| 4 | `packages/shared/src/render.ts` | `list_grants` prose: `, allow navigate ON` |
| 5 | `packages/shared/test/messages.test.ts`, `render.test.ts` | schema (all loadStates + grantStatuses) + prose |
| 6 | `packages/extension/src/background/grant-store.ts` | storage normalization + mint pass-through; re-confirm path persists the §2.7 reset flags |
| 7 | `packages/extension/src/background/index.ts` | `ctrGrantActiveTab`/`grantActiveTab` flag + audit detail + panel message; **`reconfirmByUser`: when re-pinning to a different origin, FORCE-set `autoApprove`+`allowViewportScreenshot` to false (persist via `reconfirmGrant`, regardless of stored state), pinned reset-detail audit string; ApprovalStep kind ripple (~69-72)** |
| 8 | `packages/extension/src/background/router.ts` | new branch per §3 (sibling of screenshot branch ~203-207); two-tier receipt; Freaky same-origin-only bypass; load-wait helper + cleanup invariant; in-flight serialize; `navigate_dispatched`/`navigate_completed` (both carry grantId) |
| 9 | `packages/extension/src/background/approvals.ts` | `navigate` step: full URL verbatim; **cross-origin boundary line** |
| 10 | `packages/extension/test/router.test.ts` | unit tests per §4 + §6 |
| 11 | `packages/extension/src/sidepanel/sidepanel.ts` + `.html` | "Allow Navigate" checkbox (default off, beside screenshot); **re-confirm card: danger-styled reset line ABOVE the confirm button when the origin changed; Freaky toggle DISABLED while the grant is suspended** |
| 12 | `packages/host/src/mcp-server.ts` | handler + `registerTool`; passes `NAVIGATE_TOOL_TIMEOUT_MS` (150 s, documented); description teaches: any http(s) origin, cross-origin suspends the grant + re-confirm, full URL is the consent unit, approval always for cross-origin, refs invalidated |
| 13 | `packages/host/test/mcp-server.test.ts` | registration + input validation + timeout-arg assertion + prose shapes (both tiers) |
| 14 | `REQUIREMENTS.md` | **amend G-3** (origin-transition reset rule + "applies to all cross-origin transitions"); new **C-12** (capability, two-tier, full-URL consent, Freaky same-origin-only, reset-on-new-origin, honest receipts incl. timeout/conflict/suspended, dispatch+complete audits); C-2 deferral note updated; C-9 gains "Freaky also ends on origin change"; traceability rows |
| 15 | `PROJECT_OVERVIEW.md` | status/next-actions + as-of + test-count refresh |
| 16 | `packages/extension/test/chrome-mock.ts` | `tabs.update: vi.fn()`; onUpdated emit uses full `changeInfo` shape |
| 17 | `README.md` | line 149 "scroll and navigate deliberately deferred" → update both; tool listing if present |

## 6. Tests (worker must add; lead re-runs)
- Shared: `NavigateResultSchema` (3 loadStates × 2 grantStatuses); grant schema
  default-false; TOOL_NAMES.
- Router (mocked chrome APIs): gate (observe; act without flag); §3.1 rejections
  (scheme, credentials, cross-origin NO LONGER rejected — cross-origin reaches
  approval, regression test both directions), unparseable, >2048, backslash/control
  char; URL normalization battery (port/case/IPv6/slash/`%2F`/empty-userinfo);
  same-origin success (mocked `tabs.update` + sync `onUpdated.emit` complete inside
  the mock impl); cross-origin success → `grantStatus: 'suspended'` receipt;
  redirect chain requested-B-lands-C; same-origin-redirects-off-origin → suspended;
  `chrome-error` final URL → suspended + error prose; timeout (fake timers,
  precedent approvals.test.ts:49-51); tab-closed → `grant_revoked`;
  **busy: parallel Freaky navigates AND approval-pending**; `action_timeout` audit
  path (110 s fake timers); grant expired/suspended mid-wait (navigate variants);
  `conflict` attribution (user nav during wait); cleanup invariant (no dangling
  listener after timeout/early exit); **Freaky-on + same-origin → no card, audits
  `action_auto_approved`+`navigate_dispatched`; Freaky-on + cross-origin → card
  STILL appears** (v3 guard); `navigate_dispatched` (with crossOrigin flag) +
  `navigate_completed` (with grantStatus) on all terminal paths.
- Re-confirm (§2.7): re-pin to different origin → `autoApprove`+`allowViewportScreenshot`
  false, mode/allowNavigate preserved; **re-pin force-sets false even when stored true
  (F1 regression)**; re-pin to same origin → no reset; pinned reset-detail audit
  string; `conflict`+suspended receipt shape (F7); navigate events carry grantId (F2).
- Host: registered, params validated, timeout-arg assertion (150 s), both prose tiers.
- index.ts: mint audit detail names "allow navigate".
- Full suite green before hand-back (same bar as the scroll commit).

## 7. Live verification (lead, after implementation)
1. Same-origin navigate: card with full URL → execute → receipt → fresh snapshot.
2. **Cross-origin navigate:** boundary card (even with Freaky on) → execute →
   suspension → panel re-confirm shows the new origin + reset note → Chrome per-site
   prompt for the new domain → after re-confirm: snapshot works on new origin,
   Freaky OFF, screenshot OFF (re-enable manually to confirm the toggle still works).
3. **Re-confirm permission REJECTION:** at the per-site prompt, deny → grant stays
   suspended; agent's next call fails with a clean `grant_suspended` + Next step.
4. Redirect escaping the origin (shortener/`/go`) → suspended, honest receipt.
5. Unresolvable hostname → `chrome-error` → suspended + error prose.
6. **Open question (now same-origin-only):** does `tab_screenshot_viewport` still work
   after a SAME-ORIGIN navigate (activeTab persistence)? Docs: persists; O-10 live
   log: toolbar re-invoke was needed. §3.5 Next-step text covers both outcomes.
7. Freaky on, same-origin: no card; audit shows `action_auto_approved` +
   `navigate_dispatched`.
8. **IDN (F4, UNDETERMINED):** mint on a punycode host, navigate to the Unicode form
   (and vice versa) — confirm `URL` normalization behaves consistently on both sides;
   tighten if a visually-identical-but-different host slips through.
9. **Panel behaviour (v3.1):** after a cross-origin navigate the suspended card shows
   the toggle OFF and disabled, and the danger-styled reset line above the confirm
   button; a manual cross-origin link-click shows the same line (F1/F6).
10. CWS note: navigation disclosed; the user approves the exact destination URL;
    cross-origin transitions always pause + suspend + require informed re-confirm with
    capability reset.

## 8. Execution plan (sub-agents)
- **Phase 1a (DONE 2026-09-28):** Greta (peer) + Rourke (red team) on the v2
  same-origin plan → findings applied (v2, §9).
- **Phase 1b (DONE 2026-09-28, via buddy Mira w4D:pA):** focused red team on the v3
  delta by Vera (terminal-only, pane closed, tree clean) → findings folded in as v3.1
  (§9).
- **Phase 2 (after user approves v3.1):** ONE editable implementer, handoff =
  THIS document; **buddy Mira (w4D:pA) is the controller** — launches the implementer,
  supervises live (diff, scope, tests, bounded follow-ups); lead (firstmate)
  independently inspects the final diff, runs the full suite, does the §7 live checks,
  and alone accepts + commits.
- Acceptance: suite green, diff inside §5's path set, requirements updated, scratch
  removed, panes closed.

## 9. Review log
- **v2 — Greta (peer):** host 15 s bridge timeout kills mid-approval → 150 s constant;
  `invalid_target` recovery wrong for URL errors → dedicated codes; README L149 +
  PROJECT_OVERVIEW as-of stale; post-load raw `tabs.get` race → `validateGrantForCall`;
  Freaky-branch re-validation ambiguity → both branches; missing tests (busy,
  action_timeout, mid-wait expiry, timeout-arg, mint audit); ApprovalStep ripple;
  `chrome-mock.ts` needs `tabs.update`.
- **v2 — Rourke (red team):** F1 SW-death mid-wait → `navigate_dispatched`/
  `navigate_completed` audits + honest host timeout; F2 same-origin ≠ account-safe →
  full URL is the consent unit; F3 attribution race + parallel navigates → per-grant
  `busy` + `conflict` loadState; F4 URL validation → backslash/control pre-checks +
  normalization battery + IDN live check; F5 listener leak → tested cleanup invariant;
  F6 timeout-as-success honesty → back-off hint; F7 audit completeness → dispatch +
  complete events.
- **v3 — pivot (user 2026-09-28):** cross-origin destinations allowed. Advisor
  (gemini-3.5-flash) input: Freaky same-origin-only = right line; cross-origin
  transitions must NOT carry high-risk flags → §2.7 reset rule (`autoApprove`,
  `allowViewportScreenshot` reset on re-pin to a new origin; `allowNavigate`+mode
  persist); two-tier ok-result-with-`grantStatus:'suspended'` = CWS-defensible.
  Open for user: §2.7 amends G-3 for ALL cross-origin transitions (incl. manual
  link-clicks) — sign-off needed.
- **v3.1 — Vera (red team on delta, via Mira 2026-09-28):** F1 stale Freaky toggle can
  look like it re-enables auto-approve during suspension (sidepanel.ts:186 hides it
  only for non-act) → toggle disabled while suspended + FORCE-set at re-pin
  (enforcement does not depend on panel state); F2 audit cannot reconstruct the
  sequence (no grantId linking, no reset detail, ok:true tool_call) → grantId on
  navigate events, pinned reset-detail, documented ok:true; F3 Replace/mint bypasses
  re-confirm → explicitly out of scope (fresh strict grant — convergent); F4
  intermediate-hop suspension detail ≠ final origin → documented as expected; F5 NONE
  (Freaky classification correct); F6 manual-click reset unexplained to the user →
  danger-styled line above the confirm button; F7 conflict+suspended receipt example
  missing → added. UNDETERMINED (Vera): panel-refresh timing for F1 — closed by the
  force-set regardless.
- **Carried UNDETERMINED (live, §7):** activeTab persistence after SAME-ORIGIN
  navigate (§7.6); IDN/punycode normalization (§7.8).
