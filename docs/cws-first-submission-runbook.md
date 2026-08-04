# First Chrome Web Store submission — runbook

> As-of: 2026-08-04
> Role: dashboard companion to the canonical [signed-publishing plan](./cws-signed-publishing-plan.md).
> Decision: **public listing**, published honestly and by the book.
> Companion docs: [cws-submission-readiness.md](./cws-submission-readiness.md) (gap snapshot) · [chrome-extension-enterprise-trust.md](./chrome-extension-enterprise-trust.md) (separate corporate deployment track)

## Conclusion

Publishing publicly is the selected project route. Chrome Enterprise supports managed installation of approved Store extensions ([Google Admin help](https://support.google.com/chrome/a/answer/6306504)), so a public item can still participate in the separate enterprise deployment path by Store ID.

Google's [review-process guidance](https://developer.chrome.com/docs/webstore/review-process) says most reviews complete within a few days but some take up to a few weeks, and names new developers/items, dangerous permissions, broad host patterns, and hard-to-review code as closer-review signals. This item has several of those signals. Use **days to a few weeks** as a planning buffer, not a promised range. The largest project-specific rejection risk is that a reviewer installs it, sees nothing happen without the native host, and reads that as broken functionality.

The remaining work is explicit in the canonical plan; none of it should be treated as complete until its evidence gate passes.

## Diagram

![First submission runbook](./cws-first-submission-runbook.svg)

## Primary project-specific rejection risk

Broken functionality is a documented Chrome Web Store violation category (*Yellow Magnesium*). Google's [troubleshooting guidance](https://developer.chrome.com/docs/webstore/troubleshooting) says to test the exact files submitted to the Store rather than only a separate local development build. For this project, the external native-helper dependency makes reviewer-visible non-functionality the primary identified submission risk.

**Planning assumption:** a clean reviewer environment will not already have this project's native host. Today the side panel would let the reviewer create a grant and then no agent could connect, which can reasonably appear broken.

Three mitigations, in order of value:

1. **Detect the missing host and say so.** When `chrome.runtime.connectNative` disconnects with `chrome.runtime.lastError`, the side panel should show a plain "Native helper not installed" state with a link to setup instructions — not silence. This is good product behaviour for real users too, not just reviewers.
2. **A screencast.** Unlisted YouTube or Drive link in the reviewer notes: one continuous unedited take on a fresh profile — install the host, load the extension, create a grant, trigger an action, show the approval prompt. As project-prepared evidence—not a Google requirement—the recording may also show the helper process starting and exiting without exposing unrelated processes or private data.
3. **Written reviewer notes** (template below).

## Reviewer notes template

Paste into the dashboard's reviewer-instructions field:

```text
WHAT THIS EXTENSION DOES
AI Tab Grant lets a user grant an AI agent they already run temporary,
revocable access to exactly ONE browser tab. The extension contains no AI
model. It communicates with a local companion helper; the user's selected
MCP client or AI service may process tool results under its own settings.

WHY nativeMessaging IS REQUIRED
The agent connects over a localhost MCP endpoint exposed by a companion
native messaging host. Native messaging is the supported extension-to-local-
process bridge. The extension and helper do not contact a vendor cloud;
downstream handling depends on the MCP client the user chooses.

HOW TO TEST
1. Install the companion host: <public download link>
2. Open any website, click the extension icon to open the side panel.
3. Click "Grant access to this tab" — the extension requests host permission
   for that origin only, at runtime.
4. From the agent, call the MCP endpoint shown in the panel.
5. Trigger an action; the side panel asks for per-action approval.
6. Click "Revoke" — access ends immediately.

WITHOUT THE HOST INSTALLED
The side panel shows a "Native helper not installed" state with setup
instructions. This is expected, not a failure.

SCREENCAST
<unlisted video link> — unedited, fresh profile, full install-to-action flow.

SOURCE
Full source, including the native host: <repo link>
```

## Rejection buckets, mapped to this project

Google's documented violation categories ([troubleshooting guidance](https://developer.chrome.com/docs/webstore/troubleshooting)), followed by this project's current exposure assessment:

| Bucket | Notification | Our exposure |
|---|---|---|
| Broken functionality | Yellow Magnesium | **High** — no native host on reviewer machine. See above. |
| Excessive permissions | Purple Potassium | **Medium** — `tabs` and broad optional host patterns. Both are genuinely needed; justify precisely. |
| Insufficient metadata | Yellow Zinc | Low, once screenshots and description exist. |
| Deceptive behaviour | Red Nickel / Potassium / Silicon | Low — but the listing must not overclaim. Name says "AI"; description must state no AI model is bundled. |
| Missing privacy policy | Purple Lithium | **Blocking** — none exists. Must be a URL in the Privacy tab field, not in the description. |
| Keyword stuffing | Yellow Argon | Low — avoid listing every site it "works on". |
| Single purpose | Red Magnesium / Copper / Lithium / Argon | Low — one purpose, cleanly stated. |
| Remote code | Blue Argon | **None found in current build analysis** — esbuild bundles everything, `sourcemap: false`, no `eval`. Declare "no remote code" accurately; Google's [Privacy practices guidance](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy) says remote code receives extra scrutiny. |

## Permission justifications

One per manifest entry. Reviewers compare these against actual code.

| Permission | Justification to submit |
|---|---|
| `activeTab` | Grant is created from an explicit user gesture on the current tab. |
| `tabs` | The grant is pinned to a tab id. `chrome.tabs.get/query/onUpdated/onRemoved` detect navigation away from the granted origin and tab closure, both of which revoke the grant. `activeTab` cannot observe these. |
| `scripting` | Injects the content script into the granted tab only, at grant time. No `content_scripts` block, so no install-time injection. |
| `storage` | Persists active grants and the local audit log. |
| `sidePanel` | The consent, approval and revocation UI. |
| `nativeMessaging` | Connects to the local companion host that exposes the MCP endpoint to the user's own agent. |
| `notifications` | Surfaces approval requests when the side panel is not focused. |
| `alarms` | Reconnects the native port after the MV3 service worker is terminated. |
| `optional_host_permissions: http://*/*, https://*/*` | **Never requested at install.** Requested at runtime for the single origin the user is granting, and dropped on revoke. Declared broadly only because the user may grant any site. |

That last row is the one to write most carefully: Google's [review-process guidance](https://developer.chrome.com/docs/webstore/review-process) says broad host patterns can lengthen review. The mitigating facts (no install-time host access, per-origin runtime request, revocable, no `content_scripts`) should all appear.

## Assets and copy

Dimensions and required/optional status below follow Google's [image requirements](https://developer.chrome.com/docs/webstore/images); repository status comes from the 2026-08-04 asset inspection.

| Asset | Spec | Status |
|---|---|---|
| Store icon | 128×128 PNG, 96×96 artwork + 16px transparent padding | `icon128.png` exists — **verify the padding** |
| Screenshots | 1280×800 preferred, 1–5, full bleed, square corners | **Missing** |
| Small promo tile | 440×280 | **Required — missing** |
| Marquee | 1400×560 | Optional; required only to be eligible for featuring |
| Toolbar icons | 16/32/48 | **Missing** — only 128 exists |

Per Google's [Store listing fields](https://developer.chrome.com/docs/webstore/cws-dashboard-listing), the summary caps at 132 characters. Project copy guidance: open the detailed description with one concise purpose sentence, list features plainly, and avoid keyword lists.

Draft summary to refine:

> Grant an AI agent revocable access to exactly one tab — observe by default, actions only with your per-action approval.

That is 118 characters and states the purpose without claiming to be an AI.

## Privacy policy

Google's [Privacy practices guidance](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy) requires the dashboard privacy fields, disclosures, and a privacy-policy link. Because this extension handles granted page content and tab URLs, the plan treats a working public policy URL as blocking. Use the dedicated Privacy tab rather than relying on a description link.

Must honestly cover: page content read under an active grant, tab URLs, the local append-only audit log, transfer to the localhost companion helper, and exposure through the localhost MCP endpoint. The extension/helper do not contact a vendor cloud, but the policy must state that a user-selected MCP client or AI service may process or transmit tool results under its own configuration and terms. Error logs and anonymous usage statistics also count as data collection; this project currently has neither.

GitHub Pages off this repo is sufficient and free.

## The production extension ID trap

Called out separately because it silently breaks the reviewer's install.

The native host manifest's `allowed_origins` must list the **published** extension ID. Today `packages/extension/manifest.json:5` pins a development key, and `install-native-host.mjs` registers whatever ID that produces. If the installer a reviewer downloads registers the development ID, the store-installed extension cannot connect — which presents as broken functionality.

Google's [`manifest.key` guidance](https://developer.chrome.com/docs/extensions/reference/manifest/key) documents draft upload → **Package → View public key** → add the public key to the manifest → compare local and dashboard IDs. Because adding the key changes the packaged manifest, use a strictly higher final version, rebuild/rehearse it, regenerate the host installer, then explicitly upload that exact final ZIP with **Upload New Package** before submission ([update guidance](https://developer.chrome.com/docs/webstore/update/)).

## Ordered checklist

**A. Before touching the dashboard**
1. Confirm the working Store name, then rename manifest, notifications, and agent-facing strings.
2. Add 16/32/48 icons; verify 128 padding; prepare screenshots and required promo image.
3. Establish one version source plus deterministic bootstrap/final packaging and verification commands.
4. Add the clear missing-helper state and public reviewer-helper path.
5. Build and verify an identity-bootstrap ZIP at `V_bootstrap`; label it non-release.

**B. Account — H1**
6. Register with the permanent monitored account, enable strong authentication, pay the fee, set the required publisher name, verify the required contact email through Google's emailed link, configure notifications, and check physical-address applicability ([account setup](https://developer.chrome.com/docs/webstore/set-up-account)).

**C. Identity bootstrap and final build**
7. Upload the bootstrap ZIP without submitting; retrieve Item ID and **Package → View public key**.
8. Pin the public Store key, choose `V_final > V_bootstrap`, rebuild, verify ID parity, regenerate the native-host allowlist, and produce one locked final ZIP.
9. Rehearse that exact final ZIP end to end in a fresh profile; record path, filename, version, SHA-256, source commit, and evidence.

**D. Exact package + listing — H2a**
10. Use **Package → Upload New Package** to select the single rehearsed final ZIP; verify the dashboard shows `V_final`.
11. Complete screenshots, description, summary, category, privacy policy/disclosures, permission justifications, remote-code declaration, reviewer instructions, and screencast.
12. Review legal/data-use declarations, click **Submit for Review**, and uncheck automatic publication to select deferred publishing ([publish guidance](https://developer.chrome.com/docs/webstore/publish)).

**E. Review and manual publication — H2b**
13. Plan for days to a few weeks without treating that as a commitment. On rejection, correct concretely, increment packaged versions, repeat rehearsal/upload, and resubmit. On approval, record staged expiry, recheck version/listing, and manually Publish within the live deadline (currently up to 30 days per [update guidance](https://developer.chrome.com/docs/webstore/update/)). Approval alone is not public release.
14. Verify the public URL, item ID, version, publisher, and listing; then hand corporate reviewers the ID and separate trust package.

**F. Signed future updates — H3**
15. After the item is public and custody/recovery are tested, read and capture the live Verified Uploads warning. Treat opt-in as irreversible; the human personally opts in and registers only the public key. Public guidance confirms all future package uploads require signatures after opt-in ([update guidance](https://developer.chrome.com/docs/webstore/update/)).

## Sources

- [Review process](https://developer.chrome.com/docs/webstore/review-process)
- [Troubleshooting violations](https://developer.chrome.com/docs/webstore/troubleshooting)
- [Privacy tab fields](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)
- [Image requirements](https://developer.chrome.com/docs/webstore/images)
- [Store listing fields](https://developer.chrome.com/docs/webstore/cws-dashboard-listing)
- [Register your developer account](https://developer.chrome.com/docs/webstore/register)
- [Update your item / Verified CRX Uploads](https://developer.chrome.com/docs/webstore/update/)
- [Branding guidelines](https://developer.chrome.com/docs/webstore/branding)
