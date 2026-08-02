# plan.md — Proposed solution: chrome-tab-remote

> as-of: 2026-08-02 · status: **design proposal, awaiting approval** · no code yet

## Summary

Build a **minimal MV3 Chrome extension** whose only job is: let the user grant access to **one tab** (a revocable, origin-pinned "Tab Grant"), expose that tab to any agent backend as an **MCP server** (via a local native-messaging bridge), represent the page as an **accessibility-tree snapshot**, and execute a **small deterministic action vocabulary** — with an approval gate and audit log in a side panel.

Yes, it must be an extension — that is the only sanctioned, user-visible, enterprise-manageable way to touch the user's *real* browser. Everything around it, however, is standards: WebExtensions, native messaging, MCP, ARIA/accessibility tree, WebDriver-BiDi-style action semantics, JSON Schema.

## Diagram

![Proposed architecture](./docs/solution-architecture.svg)

Flow: user grants a tab by gesture (1) → content script is injected into that tab only (2) → an agent calls MCP tools on the local bridge (3–4) → consequential actions pause at the approval gate (5) → the content script observes/acts and results flow back with an explicit ack (6–7).

---

## 1. Why a Chrome extension at all?

There are only four ways to observe/control a browser tab; three fail our trust requirements:

| Approach | Why not |
|---|---|
| **CDP / DevTools Protocol** (Playwright, agent-browser, `--remote-debugging-port`) | Controls a *separate automated browser* or requires debug flags on the real one. Full-browser power, no per-tab boundary, corporate security red flag. |
| **`chrome.debugger` extension API** | Attaches CDP to a real tab, but grants near-total power and shows a "being debugged" banner. Avoid unless DOM-level APIs prove insufficient. |
| **Google's Gemini auto browse** | Not a platform we can build on; all-tabs trust model; US-only (as of 2026-08-02). |
| **MV3 extension with content scripts** ✅ | The sanctioned path: user-visible install, reviewable permission manifest, enterprise policy control, per-tab injection possible. |

The extension route is also *more* standard than it sounds: the core API surface is the **WebExtensions API**, standardized cross-browser in the W3C WebExtensions Community Group — the same code base can later target Edge and Firefox.

### What the APIs mentioned in RESEARCH.md mean for us

- **`chrome.tabs`** — enumerate/identify tabs. We use it only to let the user *pick* a tab; reading a tab's URL/title requires permission, which the grant gesture provides.
- **`activeTab` permission** — the trust cornerstone. It grants temporary access to the current tab *only after an explicit user gesture*, with **no install-time warning** like "read all your data on all websites". Exactly matches our consent model.
- **`chrome.scripting.executeScript`** — inject our content script *programmatically into one tabId* at grant time. This replaces chrome-tracker's model of declaring content scripts on `<all_urls>` — the single biggest trust improvement.
- **`chrome.permissions.request`** — optional runtime host permission if the user wants a *persistent* grant for a specific origin (survives navigation/restart). Requested per-origin, revocable in the UI.
- **`sidePanel`** — the persistent UI surface for grant management, approvals, and the audit log (survives focus changes, unlike a popup).
- **Native messaging** (`chrome.runtime.connectNative`) — the standard WebExtensions mechanism for talking to a local companion process; solves "an extension cannot listen as a server".

## 2. Core concepts

### 2.1 Tab Grant — the capability token

The central idea from RESEARCH.md, made concrete. A grant is minted **only by user gesture** in the side panel and is the sole authority for any observation or action:

```json
{
  "grantId": "uuid",
  "tabId": 123,
  "origin": "https://app.example.com",
  "mode": "observe | act",
  "expiresAt": "2026-08-02T12:00:00Z",
  "createdByGesture": true
}
```

Enforcement rules (in the extension service worker, not in the backend):

- Every incoming command must carry a valid `grantId`; no grant → no-op with error.
- **Origin-pinned:** if the tab navigates to a different origin, the grant suspends until the user re-confirms. An injected `navigate` cannot silently widen scope.
- **Revocation:** one click in the side panel, or closing the tab, kills the grant and disconnects the content script.
- `observe` vs `act` mode implements the **trust ladder** (see rollout).

### 2.2 Page representation — accessibility-tree snapshot

The agent never sees raw DOM or screenshots. The content script produces a structured snapshot derived from the **accessibility tree / ARIA semantics** (the approach validated by playwright-mcp): roles, names, states, values, plus stable node references (`ref: "n42"`).

- Deterministic and compact — LLM-friendly, no pixel-guessing.
- Standards-based: ARIA is a W3C standard; the a11y tree is how assistive tech already reads pages.
- A natural **redaction point**: policy can strip password fields, mask configured patterns, cap size — before anything leaves the browser.

### 2.3 Action vocabulary — small, deterministic, BiDi-aligned

Actions target **node refs from the latest snapshot**, not free-form CSS selectors invented by an LLM:

`snapshot`, `click(ref)`, `fill(ref, text)`, `select(ref, value)`, `scroll(ref|page)`, `navigate(url)` *(same-origin unless re-approved)*, `read(ref)`.

Semantics deliberately mirror **WebDriver BiDi** (the W3C browser-automation standard) — not as a runtime dependency, but so the vocabulary is unsurprising, well-specified, and portable. No arbitrary JS execution in the page. Every action payload is validated against a **JSON Schema** before execution.

### 2.4 Backend protocol — MCP

The granted tab is exposed as an **MCP (Model Context Protocol) server** with the tools above. This is the decisive standards choice:

- Any MCP client becomes a valid "backend system": a custom agent, Claude Code/Desktop, or an enterprise-hosted orchestrator. We build **no proprietary agent protocol** and no agent at all for the MVP.
- Tool schemas are self-describing; approval/policy stays on *our* side of the boundary, in the extension.

Transport: the extension connects to a **native messaging host** (small local process, installed alongside the extension) which runs the MCP server (stdio, later streamable HTTP). Chain: `agent ⇄ MCP ⇄ native host ⇄ runtime port ⇄ extension ⇄ content script`.

A remote/SaaS backend is a later variant: the same extension core instead maintains an *outbound* authenticated WebSocket — the grant, lifecycle, and approval concepts are transport-independent. Local-first is the MVP because it needs no server infrastructure and keeps page content on the machine.

### 2.5 Operation lifecycle + approval gate

Fixes the reference prototype's weakest area (chrome-tracker's replay-prone file queue):

`proposed → (approved | denied) → delivered → executed → acked / failed`

- Every operation has an ID; results and acks are explicit; nothing replays.
- **Consequential actions** (anything mutating: click, fill, select, navigate) pause at `proposed` and render in the side panel for one-click approval — batch-approve for a fixed plan, per-action in strict mode. Reads (`snapshot`, `read`) auto-approve under an active grant in `observe` mode.
- Timeouts fail closed.

### 2.6 Untrusted page content & audit

- Page-derived text is **data, never instructions** — the snapshot is passed to the agent as content; injection defense on the agent side is the backend's duty, but *our* origin-pinning and approval gate cap the blast radius of a successful injection.
- **Append-only audit log** (local, exportable JSONL): every grant, snapshot, proposed/approved/denied/executed operation, with timestamps — the artifact a security team asks for first.

## 3. What we deliberately do NOT build

- No `<all_urls>` content scripts, no tracking, no knowledge store (scope decision, see `AGENTS.md`).
- No LLM inside the extension — the extension is a *deterministic policy-enforcing actuator*; intelligence lives behind MCP.
- No screenshots/pixel-coordinate clicking in the MVP (a11y snapshot first; `tabCapture` could be a later opt-in).
- No `chrome.debugger`/CDP path.

## 4. Standards inventory

| Layer | Standard |
|---|---|
| Extension platform | WebExtensions / MV3 (W3C WebExtensions CG; Chrome, Edge, Firefox) |
| Consent | `activeTab` + runtime `chrome.permissions` (per-origin, revocable) |
| Local transport | WebExtensions Native Messaging |
| Agent protocol | MCP (Model Context Protocol) |
| Page representation | ARIA / accessibility tree (W3C) |
| Action semantics | Modeled on WebDriver BiDi (W3C) |
| Validation | JSON Schema for grants, operations, tool I/O |
| Audit | Append-only JSONL, exportable |

## 5. Tech stack (proposed)

One language — **TypeScript** — across both deliverables; there is no classic frontend/backend split, but the analogous layers are:

| Layer | Choice | Rationale |
|---|---|---|
| "Frontend" = extension (side panel, service worker, content script) | TypeScript, MV3 WebExtensions API, **vanilla HTML/CSS side panel** (no UI framework), bundled with **Vite/esbuild** | Small reviewable surface is a trust feature; no framework = easier security audit |
| "Backend" = native messaging host + MCP server | **Node/TypeScript with the official MCP TypeScript SDK** for Stage 1; package later as a single binary (Node SEA / bun compile) for easy install | Most mature MCP SDK, one language repo-wide; binary packaging resolves the install-simplicity concern without switching to Go/Rust |
| Agent / LLM | **None built by us** — any MCP client (Claude Code/Desktop, custom orchestrator) | Standards choice; intelligence stays behind MCP |
| Contracts & validation | **zod** schemas (grants, operations, tool I/O) → exported as JSON Schema for MCP tool definitions | Single source of truth for runtime validation + protocol schemas |
| Storage | Grants/settings in `chrome.storage`; audit log as local **JSONL** via the native host | Local-first, exportable |
| Testing | **Vitest** + mocked `chrome.*` for unit; **Playwright** driving a fixture page + a scripted MCP client for integration | Proven MV3 mock pattern (see chrome-tracker takeaways), end-to-end over the real chain |
| Tooling | ESLint + typecheck + precommit script pattern | Mirrors reference repo conventions |

## 6. Rollout — the trust ladder

| Stage | Deliverable | Trust level |
|---|---|---|
| **1. Observe-only MVP** | Extension: tab selection → grant → side panel → `snapshot`/`read` via MCP bridge. No actions. | Read-only, one tab, local-only |
| **2. Actions + approval** | `click`/`fill`/`select`/`scroll` with lifecycle + approval gate + audit log | Mutating, every action user-approved |
| **3. Sessions & ergonomics** | Persistent per-origin grants (runtime permission), batch plan approval, strict/relaxed modes | User-tunable |
| **4. Enterprise** | Policy surface (`ExtensionSettings`, managed storage for org allow/deny lists), packaging, remote-backend variant (outbound WSS), third-party audit | Org-controlled |

Stage 1 is intentionally shippable and *useful on its own* ("let my agent read the page I chose") while establishing every security primitive the later stages rely on.

## 7. Open decisions (before Stage 1 implementation)

1. **Native host runtime** — proposed resolution in §5: Node/TS with official MCP SDK now, single-binary packaging (Node SEA / bun compile) before wider distribution. Confirm or override.
2. **Snapshot fidelity** — pure a11y tree vs a11y tree enriched with limited DOM data (links' hrefs, input values). Leaning: enriched, behind the redaction policy.
3. **Reuse audit** — read nanobrowser's DOM-extraction/guardrail code and playwright-mcp's snapshot format for concrete borrowing (formats, not frameworks) before writing Stage 1 code.

## 8. Verification approach

- Unit: grant enforcement, origin-pin suspension, lifecycle state machine, schema validation (Vitest + mocked `chrome.*`, mock pattern proven in chrome-tracker — see `docs/chrome-tracker-takeaways.md`).
- Integration: MCP client script driving snapshot/act against a fixture page; assert approval gating and audit entries.
- Manual trust review: install-time permission prompt must stay warning-free (`activeTab` path); revocation and origin-change suspension demonstrated in the side panel.
