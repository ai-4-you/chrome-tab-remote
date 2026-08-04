# Chrome Web Store submission readiness

> As-of: 2026-08-04
> Role: gap-analysis snapshot subordinate to the canonical [signed-publishing plan](./cws-signed-publishing-plan.md).
> Status: **planning — not started**. Scope is the extension package + store listing only. Native-host productisation and the corporate security-review package are tracked separately in [chrome-extension-enterprise-trust.md](./chrome-extension-enterprise-trust.md).

## Conclusion

Seven things block a submission. D1 (Verified CRX Uploads after initial approval) is settled. The existing analysis recommends "AI Tab Grant" as the working name; final confirmation is batched into the canonical plan's short pre-Stage-2 decision reply. The exact blockers are:

1. **B1 — Confirm and implement the Store-facing name.** "AI Tab Grant" is the recommended working default; after confirmation, update the manifest, notifications, and agent-facing strings.
2. **B2 — Publish accurate privacy material.** Host the policy publicly and complete disclosures for page content, URLs, local audit data, the localhost helper, and downstream MCP-client handling.
3. **B3 — Make reviewer setup credible.** Add a clear missing-helper state and a reproducible public helper path; keep the macOS/platform limitation explicit.
4. **B4 — Finalize permission justifications.** Map every manifest permission and broad optional host pattern to verified code usage and the single purpose.
5. **B5 — Produce compliant listing assets.** Verify icon padding; create exact-size screenshots and the required 440×280 promo image; add missing toolbar icons.
6. **B6 — Align the permanent Store ID.** Obtain the dashboard public key, verify local/dashboard IDs, and regenerate native-host `allowed_origins`.
7. **B7 — Produce a deterministic, correctly versioned artifact.** Unify the version source, generate the Store ZIP/CRX through reviewed commands, and fail closed on unexpected contents.

## Diagram

![Submission readiness flow](./cws-submission-readiness.svg)

## Decisions taken

### D1 — Use Verified CRX Uploads (2026-08-02)

Package updates will be signed with a publisher-controlled 2048-bit RSA key, so a compromised developer account cannot ship an update on its own.

Sequencing consequences:

- The **first** upload is still a ZIP. Opt-in lives on the dashboard's Package tab and applies to an item that already exists.
- After opt-in, **every** update must be a signed `.crx` — this changes B7 from "produce a ZIP" to "produce a signed CRX".
- The private key must not live in the Google account it protects. Escrow location is an open question.
- Losing the key requires CWS support intervention, up to one week. Treat it as a high-value release credential with a documented recovery path.
- Google states that verified uploads are checked with the publisher key and then repackaged with the existing Store key, preserving the extension ID. Still verify ID parity as a release gate because native messaging fails if `allowed_origins` drifts.

Source: [Update your Chrome Web Store item](https://developer.chrome.com/docs/webstore/update/)

### D2 — Working Store-facing name: "AI Tab Grant" (analysis dated 2026-08-02; confirmation pending)

Provisional resolution for B1, subject to the canonical plan's batched pre-Stage-2 confirmation. No Google trademark, so no `™` construction is needed.

Rationale: the product's purpose is to let an AI agent access a tab collaboratively. "AI" names what the extension grants access to, and "grant" carries the consent model (user-given, one tab, revocable). Time-sensitive observation from the 2026-08-02 Store search: no item using "Tab Grant" or "AI Tab Grant" was found; recheck before final confirmation.

Two consequences for the listing copy:

- State explicitly that the extension contains no AI model or project-operated cloud service. It sends granted data to the localhost helper/MCP endpoint; a user-selected MCP client or AI service may then process or transmit the results under its own configuration and terms.
- The `AI Tab *` namespace is crowded with tab organisers (AI Tab Organizer, AI Tab Master, Tabaroo, Group Tab AI). The first line of the description must make the grant-access purpose unmistakable so the item is not read as another tab-grouping tool.

### D3 — Public listing (2026-08-02)

Publish publicly and by the book, rather than private/domain publishing. This does not cost the corporate goal: an administrator can force-install any public Web Store extension by ID, so the enterprise path in [chrome-extension-enterprise-trust.md](./chrome-extension-enterprise-trust.md) stays open.

Project consequence: company Workspace ownership is not required for the selected public route. H1 must still choose a permanent publisher owner, monitored address, recovery method, and strong authentication using Google's [registration guidance](https://developer.chrome.com/docs/webstore/register).

Operational steps live in [cws-first-submission-runbook.md](./cws-first-submission-runbook.md).

## Blockers

### B1 — Product name uses a Google trademark

> **Provisionally resolved by D2** — working name is "AI Tab Grant"; confirm it in the pre-Stage-2 decision reply before the rename work below.

Google's [Branding Guidelines](https://developer.chrome.com/docs/webstore/branding) require written permission to use a Google trademark in an extension or company name. The sanctioned pattern for compatibility claims is `"<Your Name> for Google Chrome™"`, with the trademark symbol.

Affected, user-visible:

| Location | Current value |
|---|---|
| `packages/extension/manifest.json:3` | `"name": "Chrome Tab Remote"` |
| `packages/extension/manifest.json:27` | `"default_title": "Chrome Tab Remote"` |
| `packages/extension/src/background/notifications.ts:30,40` | notification titles |
| `packages/shared/src/errors.ts:36`, `packages/shared/src/render.ts:49` | agent-facing guidance text |

Not affected — these are internal identifiers, never shown in the store, and changing them would break existing installs for no policy benefit:

- native host name `com.cgint.chrome_tab_remote`
- data directory `~/.chrome-tab-remote`
- npm workspace names, repo name, binary name

### B2 — No privacy policy

Required whenever an extension handles user data. The listing needs a public URL plus data-handling disclosures and the limited-use certification. Content must cover page content read under a grant, tab URLs, the local audit log, transfer to the localhost companion helper, and exposure through its localhost MCP endpoint. The extension/helper do not contact a project-operated cloud service; a user-selected MCP client or AI service may process or transmit tool results under its own configuration and terms.

### B3 — Reviewers cannot exercise the extension

Without the native host the side panel can grant, but no agent connects. Google documents broken functionality as a violation in its [troubleshooting guidance](https://developer.chrome.com/docs/webstore/troubleshooting); for this project, an extension that appears inert is therefore a submission risk. Options, in order of preference:

1. Preferred: ship a downloadable, checksummed helper bundle/installer and link it in **Test Instructions**.
2. Minimum credible fallback: publish a built helper artifact with an explicit Node prerequisite, one install command, uninstall instructions, and an honest macOS-only statement.
3. If Google requires an exercisable helper on another reviewer platform, defer submission until that platform is productised.

A reviewer walkthrough and screencast support these paths; they do not replace working setup or a clear missing-helper state. Separate code-signing/notarization remains part of the corporate track unless Google makes it a review condition.

### B4 — Permission justifications

Every permission needs a written justification in the Privacy tab. Verified usage:

| Permission | Justified by |
|---|---|
| `activeTab` | grant creation from an explicit user gesture |
| `tabs` | `chrome.tabs.get/query/onUpdated/onRemoved` — grant is pinned to a tab id and must be revoked on navigation or close |
| `scripting` | programmatic injection of `content.js` into the granted tab only |
| `storage` | grant state and audit records |
| `sidePanel` | the consent and approval UI |
| `nativeMessaging` | the local MCP bridge |
| `notifications` | approval prompts when the panel is not focused |
| `alarms` | native-port reconnect (`native-port.ts`) |
| `optional_host_permissions: http://*/*, https://*/*` | requested at runtime per origin, never at install |

The broad optional host pattern draws the most scrutiny. The mitigating argument — no install-time host access, per-origin runtime request, revocable — must be stated explicitly.

### B5 — Store listing assets missing

Google's [image requirements](https://developer.chrome.com/docs/webstore/images) require at least one screenshot at 1280×800 or 640×400 and a 440×280 small promotional image. `icon128.png` has the correct outer dimensions but its artwork padding still needs verification. The existing 1322×1630 README screenshot is not an accepted Store screenshot size; the promo image is missing.

### B6 — Manifest `key` is pinned to a development ID

`packages/extension/manifest.json:5` hardcodes a public key to keep a stable local ID. Google's [`manifest.key` guidance](https://developer.chrome.com/docs/extensions/reference/manifest/key) documents the draft-upload → View public key → manifest-key process for matching the local and Store item IDs. Because that ID is baked into the native host's `allowed_origins` (no wildcards permitted), it cannot stay ambiguous.

Resolution: upload the ZIP as an unpublished draft → **Package → View public key** → replace the current `key` value with the store's → rebuild. Dev and production then share one ID and one `allowed_origins` entry.

### B7 — No deterministic packaging or unified version source

`dist/` is gitignored and there is no script producing a submission artifact. Hand-zipping risks shipping the wrong tree. Version metadata also drifts: `manifest.json` says `0.1.0`, while `packages/extension/package.json` says `0.0.0`.

Per D1 the release path needs two modes: a correctly versioned ZIP for the initial draft upload and a signed `.crx` for updates after Verified CRX Uploads is enabled. Implementation candidate—not yet verified in this repository: sign with Chrome's pack-extension flags or a reviewed CRX3 library. The key path must come from protected release configuration, never the repo.

## Should-fix

- **Icon set**: only `icon128.png` exists. Add 16/32/48 for the toolbar and the extensions management page.
- **`homepage_url`** and a support contact in the listing.
- **Single-purpose statement**: one sentence, must match what the permissions do.
- **Remote code**: none — everything is bundled by esbuild with `sourcemap: false`. Declare this accurately; Google's [Privacy practices guidance](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy) says remote code receives extra scrutiny.

## Verified during this analysis

- `chrome.tabs` is genuinely required (not replaceable by `activeTab` alone) — `chrome.tabs.get`, `query`, `onUpdated`, `onRemoved`, `sendMessage` across `background/index.ts`, `background/router.ts`, `sidepanel.ts`.
- The build produces four files plus statics; bundle size (~150 KB per entry) is dominated by `zod` and is unminified. Project inference: authored-format code is easier to inspect; Google's [review-process guidance](https://developer.chrome.com/docs/webstore/review-process) identifies hard-to-review code as a delay factor.
- No `content_scripts` block in the manifest — injection is programmatic, so no install-time host permissions. This is a genuine review advantage.

## Open questions

1. Confirm the D2 working name, "AI Tab Grant", in the pre-Stage-2 decision reply before rename implementation.
2. Where does the privacy policy get hosted? GitHub Pages off this repo is the default unless there is a reason otherwise.
3. ~~Publisher account~~ Answered by D3: personal account is sufficient for public listing.
4. ~~Submit before the native host is productised?~~ Working route from D3 + runbook: prepare a public listing with a clear missing-helper state, reviewer instructions, and a screencast. A signed installer remains planned for the separate corporate track; if Google requires broader reviewer-platform support, pause and productise it rather than simulate functionality.
5. Where is the Verified CRX signing key escrowed, and who can access it? (D1)
