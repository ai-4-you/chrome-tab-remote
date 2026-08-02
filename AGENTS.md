# AGENTS.md — chrome-tab-remote

Durable collaboration memory for this repository. Read `PROJECT_OVERVIEW.md` first for current state and next actions.

## What this repo is

A **trust-first Chrome extension** (plus backend communication) that lets a user explicitly select **one tab** which a backend/agentic system may then inspect and control. Security and corporate adoptability are the product's core differentiator, not an afterthought. North star: `IDEA.md`.

## Scope decisions (durable)

- **2026-08-02:** Focus is the Chrome extension and its communication with a backend system only. The knowledge-gathering/RAG side of the reference system chrome-tracker is explicitly **out of scope**.
- The extension is purpose-built for interactive tab control — no tracking/knowledge-base machinery bundled in.

## Design principles

- **Agent-facing output is prose-shaped:** the consumer of MCP tool results is a language model, so compact readable text **is** the machine format. JSON only earns its place when something programmatic re-reads the result — and then as MCP `structuredContent` *alongside* the text, never instead of it. Errors follow the same rule: every error carries a concrete "Next step:" recovery instruction, not just a diagnosis.

- **Per-tab consent as a capability token:** the user's explicit tab selection — not "whatever tab is active" — authorizes observation/control.
- **Minimal permissions:** avoid `<all_urls>`; prefer runtime/host-scoped permissions and `activeTab`-style gestures.
- **Real operation lifecycle:** operation IDs, explicit approval for consequential actions, ACK/drain, no replay (the reference prototype's main gap).
- **Page content is untrusted input** (prompt-injection risk — Google documents this for its own auto browse).
- Dangerous capabilities off by default, with visible user control.

## Key documents

| Doc | Role | Freshness rule |
|---|---|---|
| `PROJECT_OVERVIEW.md` | Fast re-entry map: state, next actions, open questions | Update whenever state changes; check `as-of` |
| `REQUIREMENTS.md` | Canonical numbered requirements list (what the system shall do, with status + traceability) | Every behavior change updates it in the same commit |
| `IDEA.md` | Original intent / north star | Stable |
| `RESEARCH.md` | Append-only research log (Chrome auto browse, OSS landscape) with dated entries | Re-verify rollout/product claims before commitments |
| `docs/chrome-tracker-takeaways.md` | Reference system `~/dev/chrome-tracker/`: reusable patterns + gaps to fix | Snapshot as-of 2026-08-02; verify against source before reuse |

## Startup routine for a new session

1. Read `PROJECT_OVERVIEW.md` (state, blockers, next actions).
2. If touching architecture/security: skim `docs/chrome-tracker-takeaways.md` and the latest `RESEARCH.md` entries.
3. Planning-first: no implementation without an approved plan/RFC (per user's global workflow).

## Memory boundary

- Repository-owned knowledge (decisions, status, research, architecture) lives in the files above — never only in a private `agent/` workspace.
- If an `agent/` directory is ever created, it holds only internal scratch/evidence and must stay out of commits unless explicitly approved.
- Date-stamp anything that can age (research claims, reference-system snapshots, status).

## Known risks / watch items

- Google's **Gemini in Chrome auto browse** overlaps this idea but with a broader (all-tabs) trust model and US-only availability as of 2026-08-02 — our narrower per-tab boundary is the differentiator; re-check rollout before positioning claims.
- Candidate OSS bases (nanobrowser, playwright-mcp, browser-use — see `RESEARCH.md`) need license + permission-model audits before adoption.
