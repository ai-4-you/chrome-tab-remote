# PROJECT_OVERVIEW — chrome-tab-remote

> as-of: 2026-08-02 · phase: **ideation / research — no product code yet**

## Current state

- Repo contains intent, research, and reference analysis only (one commit: `init idea`).
- Idea clarified: trust-first Chrome extension; user selects **one tab** a backend/agent may inspect and control. See `IDEA.md`.
- Scope decided: extension + backend communication only; no knowledge-gathering machinery (see `AGENTS.md`).
- Reference system analyzed: `~/dev/chrome-tracker/` proves both primitives (context upload, operations backchannel) and exposes the gaps to fix — `docs/chrome-tracker-takeaways.md`.
- Web research done (2026-08-02): Google auto browse status/limits, Chrome API building blocks, five candidate OSS projects — `RESEARCH.md`.

## Next actions

1. Write the MVP-scoping RFC: target users + distribution channel, privacy posture, supported page types/actions, backend form (local vs self-hosted vs SaaS), build-vs-reuse call on nanobrowser / playwright-mcp / browser-use.
2. Design the operation lifecycle (IDs, approval gate, ACK/drain, transport: poll vs SSE/push) — the reference prototype's weakest area.
3. Design the per-tab selection/consent model (`chrome.tabs.query` + user gesture + stored tab ID as capability token).

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
