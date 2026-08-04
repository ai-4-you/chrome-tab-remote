# REQUIREMENTS — chrome-tab-remote

> as-of: 2026-08-02 · Canonical requirements list, gathered from IDEA.md, plan.md, and the 2026-08-02 collaboration sessions.
> Status values: **implemented** (code + tests), **verified-live** (also exercised against real Chrome), **proposed** (agreed direction, awaiting implementation approval).
> Maintenance rule: every behavior change lands here in the same commit; requirements are numbered and never renumbered (retire with ~~strikethrough~~ instead).

## 1. Product intent (north star)

- **N-1** One user-selected tab — never "the browser". The user points at exactly one tab; everything else is invisible to the agent.
- **N-2** Trust is the product: small, boring, reviewable, corporate-approvable. No tracking, no bundled AI, and no project-operated cloud service. Granted data is exposed through the local helper's localhost MCP endpoint; a user-selected MCP client or AI service may process or transmit it under that service's own configuration and terms.
- **N-3** Standards over invention: WebExtensions/MV3, MCP, ARIA semantics, WebDriver-BiDi-aligned action vocabulary, JSON Schema (zod).
- **N-4** Local-first: all components shipped by this project run on the user's machine. The separately chosen MCP client may use an external service and is outside this project's runtime boundary. **Decision 2026-08-02:** MCP endpoint auth is *deprioritized* — the extension/helper deployment is local; localhost binding + DNS-rebinding protection are the accepted boundary for now.
- **N-5** Page content is **untrusted input**: page-derived text is data, never instructions. Injection defense on the agent side is the backend's duty; origin-pinning and (in Stage 2) the approval gate cap the blast radius of a successful injection.

## 2. Consent & grant (the trust boundary) — implemented

- **G-1** Access exists only through a **Tab Grant** minted by an explicit user gesture in the side panel. No gesture → no grant → every tool call fails.
- **G-2** At most **one** grant at a time; it targets exactly one tab.
- **G-3** A grant is **origin-pinned**. Navigation to a different origin suspends it until the user re-confirms — and the panel shows the exact origin being re-approved (informed re-confirm).
- **G-4** Grants expire automatically after **30 minutes**. Enforcement happens in the extension (service worker), never in the host.
- **G-5** Revocation is instant: one click in the panel, or closing the tab. Both drop the runtime site permission again (teardown also on failed injection and on re-confirm to a new origin).
- **G-6** No install-time host permissions, ever. Per-origin permission is requested at grant time inside the user gesture (`optional_host_permissions`); Chrome's prompt names that one site, never "all sites".
- **G-7** Every tool call re-validates at call time: grant exists → usable (not expired/suspended/revoked) → tab still exists → live origin still matches the pin. Fails closed on any mismatch.
- **G-8** Grants are **session-scoped** (`chrome.storage.session`): an extension reload or browser restart clears them — fail-closed by construction. Re-granting after a reload is expected behavior, not a bug.
- **G-9** The side panel renders **relative to the active tab** — grant boundaries are presented by **tab-id**, never by domain (two same-domain tabs are different trust objects). On a non-granted tab: "This tab is NOT shared" + a clearly separated "granted on another tab" card (title, expiry, go-to-tab, revoke); the grant button becomes an explicit **Replace**. The audit view is per-tab by default (entries stamped with `tabId`; system events carry none) with a "show all" toggle; the host JSONL stays the complete global ledger. Approval cards show on every tab (time-critical), labeled with the granted origin + go-to-tab.

## 3. Observation (Stage 1 tools) — implemented

- **O-1** The agent sees an **accessibility-style snapshot** (roles, accessible names, values, stable refs `n0…`) — never raw HTML, never screenshots.
- **O-2** Password values are **always `[redacted]`**, in snapshots and in `tab_read`, with no bypass.
- **O-3** Hidden elements (display:none, visibility:hidden, aria-hidden, hidden) and non-content tags (script/style/svg/iframe/…) are excluded.
- **O-4** Size discipline with honest markers: 1500-node cap (`truncated` flag), 120-char names and 300-char hrefs cut with a visible `…`, 200k-char `tab_read` cap with an inline `[truncated: N more chars]` marker. Nothing is silently cut.
- **O-5** Link nodes carry their absolute **http(s) href** (other schemes omitted).
- **O-6** `tab_snapshot` supports `filter: 'interactive' | 'full'` — interactive keeps only actionable elements plus headings.
- **O-7** Nameless interactive elements get accname-style fallback names: placeholder → inner img alt → title. Visible text always wins.
- **O-8** `tab_read(ref)` returns the full (capped) text of one element from the **latest** snapshot; unknown refs fail with `unknown_ref`.
- **O-9** `tab_find(query, role?)` (implemented 2026-08-02) searches names/values/URLs case-insensitively and returns matching nodes as snapshot lines (capped 30) — cheaper than full snapshots on large pages. It takes a fresh snapshot internally, so it announces that all earlier refs are stale.

## 4. Agent experience (MCP surface) — implemented

- **X-1** The tab is exposed via **MCP** (Streamable HTTP, `127.0.0.1:8917/mcp`, DNS-rebinding protected). Any MCP client can be the agent; we ship none.
- **X-2** **Prose-shaped output is the machine format** (see AGENTS.md): snapshots as compact indented text, `tab_read` as plain text (`[empty — …]` when the element is empty), `list_grants` as one line per grant with expiry as derived minutes.
- **X-3** Every error carries a concrete **"Next step:"** recovery instruction (usually: what to ask the user to do).
- **X-4** `grantId` is optional on every tool — it defaults to the single grant; audit records the resolved id.
- **X-5** Expiry wins over stored status: an expired grant is reported "expired + re-grant instruction", never "active" and never "re-confirm".
- **X-6** Tool descriptions teach the workflow (snapshot first, ref lifetime, redaction, `…` truncation semantics) — an agent needs no external docs.

## 5. Audit & fail-closed behavior — implemented

- **A-1** Every grant lifecycle event and every tool call (including `list_grants`) is audited: live in the side panel and append-only JSONL at `~/.chrome-tab-remote/audit.jsonl`.
- **A-2** The host answers nothing from caches: grant enumeration and all tool calls route through the extension; extension disconnected → error, not stale data.
- **A-3** Native messaging is desync-safe: 1 MB frame limit respected, oversized frames skipped without corrupting the stream, alarm-based reconnect survives MV3 service-worker death.

### Live-verification status (evidence, 2026-08-02)

**Verified against real Chrome:** grant gesture + per-origin prompt (G-1/G-6), snapshot/read/list via MCP without grantId (O-1…O-8, X-1…X-4, X-6), interactive filter, hrefs, `…` markers, accname fallbacks, prose outputs, session-scoped grant loss on reload (G-8), `no_grant` recovery text (X-3), audit JSONL on both sides (A-1/A-2).
**Also live:** grant expiry occurred naturally (G-4 ✓, 2026-08-02); the pre-fix host rendered it "active, expired", confirming the X-5 fix was needed — X-5's corrected output gets its live tick at the next host reload.
**Unit-tested only:** suspension/informed re-confirm (G-3), tab-close revocation + teardown (G-5), `[empty]` read marker — folded into the Stage 2 live-test session. **Unit coverage is the appropriate final evidence** (defensive paths not sensibly producible live): call-time origin re-check (G-7, race-window defense behind G-3) and oversized-frame handling (A-3).

## 6. Engineering constraints

- **E-1** TypeScript everywhere; zod schemas in `@ctr/shared` are the single contract source (extension ⇄ host ⇄ MCP).
- **E-2** No UI frameworks, no `<all_urls>`, no `chrome.debugger`/CDP, no arbitrary JS execution in pages.
- **E-3** `./precommit.sh` (typecheck + lint + tests + dependency audit) green before every commit; TDD for behavior changes.
- **E-4** Known accepted gaps: helper runs from repo (no packaged binary), installer macOS-only, no MCP auth (N-4).
- **E-5** **Multi-browser (2026-08-02, verified-live Chrome+Brave):** each browser spawns its own host, each with its own MCP port and audit dir (chrome 8917/`~/.chrome-tab-remote`, brave 8918/`~/.chrome-tab-remote-brave`). Mechanism: ONE **browser-detecting dispatcher launcher** (inspects its parent process at spawn) shared by all manifests — required because, verified empirically, Brave resolves the host via Chrome's NativeMessagingHosts fallback even when Brave's own directory has a manifest. Grants/approvals/audit never cross browsers; agents choose the browser by port; the panel displays its own endpoint (`hostInfo` message). Port collisions fail with a self-explaining fatal log.

## 7. Control (Stage 2) — implemented 2026-08-02; core flows **verified-live** same day: approve→execute (real click, page navigated, prose result), deny→`approval_denied` (page untouched), timeout auto-deny (×4), post-action stale-world recovery, full audit chain (`action_proposed`/`action_denied`/`action_timeout`), and **C-9 Freaky mode** (real task run: instant Samstag-filter click, `action_auto_approved` audited, `list_grants` announced it; flipped off mid-session → very next action paused and was denied). Unit-only: observe_only gate, password-fill refusal, select options, mid-wait revocation.

The controlling half of IDEA.md ("…and control the page"). Everything below inherits sections 2, 4, 5 unchanged — control adds capabilities, it never loosens the consent model.

- **C-1** Grants get a mode chosen by the user **at grant time**: `observe` (default) or `act` (checkbox in the side panel). Observe-mode grants can never execute actions (`observe_only`, checked before the tab is even contacted).
- **C-2** Action vocabulary (BiDi-aligned, deliberately small): `tab_click(ref)`, `tab_fill(ref, text)`, `tab_select(ref, value)`. Targets are **refs from the latest snapshot only** — no CSS selectors, no coordinates, no JS. (`scroll` and `navigate` deferred to a later slice; navigate has origin implications.)
- **C-3** **Approval gate:** every action pauses as a proposal in the side panel ("Agent wants to click *button "Save"* — with the exact fill text shown verbatim), executes only after an explicit user click. Strictly one pending approval at a time; per-action (batch approval is a later ergonomic). The agent is told to expect up to 2 minutes.
- **C-4** Approval lifecycle with unique operation ids; denials and timeouts **fail closed** (`approval_denied` / `approval_timeout`; auto-deny after 110 s); nothing replays. After an approval wait the grant is **fully re-validated** (expiry, suspension, tab, origin) before execution — a grant revoked mid-wait executes nothing.
- **C-5** **Stale-ref protection is mandatory:** refs are monotonic across snapshots (snapshot 2 starts numbering where snapshot 1 ended), so a ref from an older snapshot is detectable by construction → `stale_ref` error instead of clicking the wrong thing. Stale refs are rejected **before** the user is asked to approve.
- **C-6** `<select>` options (labels + values) are visible on combobox snapshot nodes (capped at 20 with `…`) — an agent cannot choose a value it cannot see.
- **C-7** Every proposal, decision, and execution is audited on both sides (`action_proposed`/`action_approved`/`action_denied`/`action_timeout` + the existing `tool_call`).
- **C-8** Action results are prose with the next step ("Clicked button "Save" (n7). The page may have changed — take a new tab_snapshot…"). Password fields refuse `tab_fill` — the write-side mirror of O-2.
- **C-10** **Plan approval (implemented 2026-08-02):** a single action IS a 1-step plan — one unified gate. `tab_plan` submits up to 10 steps approved **as one whole**: the user sees the full numbered list (with exact fill texts), and the approved plan is **frozen** — no deviation possible. Execution is sequential and stops at the first failure with an honest partial report; elements detached by earlier steps fail `stale_ref` instead of acting on ghosts.
- **C-11** **Honest post-action re-orientation (implemented 2026-08-02):** every action result embeds a fresh interactive snapshot taken after a DOM-settle wait (mutation-quiet 250 ms, capped at 2 s) — and **always states its confidence**: `settled`, `still-changing` ("snapshot may be incomplete — re-snapshot if results look wrong"), or `interrupted` (navigation killed execution; completed-step count explicitly unknown; the background waits for the load, re-injects, snapshots the new page). The agent is never led to believe it reliably sees final content. No auto-retry of plans — a lost channel could mean actions already ran.
- **C-9** **"Freaky mode"** (auto-approve, UI name per user 2026-08-02): the user can suspend the per-action pause — actions then execute immediately. Guardrails: off by default; act grants only; toggleable **live** in the side panel while agent actions are ongoing (the gate reads the current grant state per action); dies with the grant (revoke/expiry/replacement → next grant starts strict); loud danger-styled UI on the grant card and a warning on the "granted elsewhere" card; fully audited (`auto_approve_enabled`/`auto_approve_disabled` + `action_auto_approved` per action); a proposal already pending when it's enabled still requires its explicit decision; `list_grants` announces "auto-approve ON" to the agent.

## 8. Attention & bidirectional consent — implemented + verified-live 2026-08-02 (badge/panel attention ✓; request_grant full round trip ✓; system notification suppressed by macOS — accepted per T-1)

- **T-1** Anything awaiting the user raises **out-of-panel attention**. Guaranteed signal: the red `!` **toolbar badge** (+ the panel card). Best-effort signal: a system notification with the concrete ask — the OS may suppress it (macOS blocks Chrome notifications by default) and that is **accepted, not a defect** (user decision 2026-08-02; live test confirmed badge+panel suffice). Both clear on decision/timeout; notification clicks jump to the granted tab.
- **T-2** `request_grant(reason?, mode?)` lets the **agent ask** for a tab: the panel shows a request card with the verbatim reason (+ notification), and the call waits up to ~2 min. The `mode` enum (`observe` default | `act`) states the needed capability and renders **structured + color-coded** (👁 blue read-only vs ⚡ red "OBSERVE + ACT requested … tick 'allow actions'"). It is a **hint only**: the answer is always the user's normal grant gesture on a tab of **their** choice, with the checkbox as their sole decision — granting observe against an act request is a valid answer. Dismissal/expiry fail closed (`no_grant`); requests are audited with the requested mode. (Added 2026-08-02 after live use: an agent under-asking led to an observe grant for a click task; audit-list CSS also fixed to wrap instead of truncating reasons.)

## Traceability

| Area | Enforced in | Tested in |
|---|---|---|
| G-* | `packages/extension/src/background/` (grant-store, router, origin-permission) | `extension/test/{grant-store,router,background}.test.ts` |
| O-* | `packages/extension/src/content/snapshot.ts` | `extension/test/snapshot.test.ts` |
| X-* | `packages/host/src/mcp-server.ts` + `packages/shared/src/{render,errors}.ts` | `host/test/mcp-server.test.ts`, `shared/test/render.test.ts` |
| A-* | `extension/src/background/audit.ts`, `host/src/{audit-log,bridge,native-messaging}.ts` | `host/test/{bridge,native-messaging}.test.ts` |
| C-* | `extension/src/background/{router,approvals}.ts`, `extension/src/content/actions.ts` | `extension/test/{router,approvals,actions}.test.ts`, `host/test/mcp-server.test.ts` |
