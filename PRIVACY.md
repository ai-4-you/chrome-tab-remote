# Chrome Tab Remote — Privacy Policy

> **Effective:** 2026-08-26 · applies to the Chrome extension "Chrome Tab Remote" and its locally-installed companion helper (the MCP bridge).
> Developer: Christian Gintenreiter · contact: [christian.gintenreiter@gmail.com](mailto:christian.gintenreiter@gmail.com)

## What this extension does

Chrome Tab Remote lets you grant an AI agent revocable, origin-pinned access to **exactly one tab** that you explicitly select. The agent can read that tab's content, and — only if you opt in and approve each action individually — interact with it (click, fill, select). You can revoke the grant at any time.

## What data is involved

| Data | Where | Notes |
|---|---|---|
| Content of the tab you granted (text, headings, links, form controls) | Read in-memory by the extension; passed to the local helper | Only the tab you explicitly selected. Origin-pinned: the grant suspends automatically if the tab navigates away. |
| Viewport screenshot (optional, **default-off**) | In-memory only | Requires a separate explicit opt-in ("Allow ViewportScreenshot"). Never persisted to disk, never sent to a remote server. |
| Grant metadata (origin, expiry, capabilities) | `chrome.storage.session` | Session-only: cleared when the browser session ends. 30-minute maximum lifetime; auto-revoked on tab close or navigation to another origin. |
| Extension audit ring (grant / read / action events) | `chrome.storage.local`, capped at the most recent 500 entries | Stored **on your device only**, visible in the side panel, and clearable by you. |
| Helper audit log | Append-only `audit.jsonl` in the helper data directory (default `~/.chrome-tab-remote`) | Stored on your device only. The helper rotates it at 10 MiB and retains one prior generation (`audit.jsonl.1`). This host-file log is not side-panel-clearable. |

**No other data is collected.** The extension does not collect account data, browsing history, cross-site behavior, or any information about tabs you did not grant. It contains no analytics, no crash reporting, no advertising, and no third-party SDKs.

## Where data goes

```text
your granted tab
  └─> Chrome Tab Remote extension (browser process, your machine)
        └─> local companion helper (native messaging, 127.0.0.1 only)
              └─> local MCP endpoint (localhost only)
                    └─> your MCP client / AI service  ← YOUR explicit choice
```

- **The extension and the helper make no network requests to any remote server.** All communication stays on your machine (native messaging + localhost).
- The final step — your MCP client forwarding tool results to an AI model or other service — is configured by **you**, using **your own** client and credentials. The extension neither selects nor sees that destination.
- The developer of this extension **does not receive, store, or process** any content from granted tabs. We have no servers, no accounts, and no data pipeline.

## What we never do

- ❌ Sell, transfer, or share your data with third parties.
- ❌ Use your data for advertising, profiling, or any purpose unrelated to the extension's single purpose.
- ❌ Use or transfer your data to determine creditworthiness or for lending.
- ❌ Read or act on any tab you did not explicitly grant.
- ❌ Send page content to remote servers or third parties.
- ❌ Collect usage analytics, telemetry, or crash reports.

## Your controls

- **Per-tab grant:** access begins only when you explicitly select a tab; the grant is pinned to that tab's origin and expires after 30 minutes at most.
- **Per-action approval:** actions (click, fill, select) execute only after your explicit approval in the side panel; unapproved requests auto-deny after 110 seconds.
- **Revoke anytime:** the side panel provides an immediate revoke; closing the tab or navigating to another origin also revokes automatically.
- **Inspect and clear:** the extension audit ring (last 500 events) is visible in the side panel and clearable by you. The helper's separate `audit.jsonl` file is not cleared by this control.
- **Permissions:** the extension uses `activeTab`, `alarms`, `tabs`, `scripting`, `storage`, `sidePanel`, `nativeMessaging`, `notifications`, and optional `http://*/*` / `https://*/*` host permissions. All are scoped to the granted-tab boundary described in the Chrome Web Store listing; `tabs` is used only to enforce that boundary (origin change → suspend, tab close → revoke). No broad host permission is exercised on any tab you did not grant.

## Data storage

All data lives on your device: session storage (grant state, wiped at browser exit); local storage (a capped, side-panel-clearable extension audit ring); and the helper's append-only local `audit.jsonl` file (default `~/.chrome-tab-remote`, rotated at 10 MiB with one prior generation retained). There are no remote databases, no caches on third-party infrastructure, and no persistent on-disk capture of tab content.

## Children

This extension is not directed at children, and we do not knowingly collect data from anyone under 13.

## Changes to this policy

Material changes will be announced via the Chrome Web Store listing before they take effect. When in doubt, re-read the latest version at the URL linked from the Store listing.

## Limited Use statement

In accordance with the Chrome Web Store program policies: any information that Chrome Tab Remote receives from Google (for example via the Chrome Web Store APIs) will adhere to the Chrome Web Store User Data Policy, including the Limited Use requirements. The extension itself sends no data to Google or any other remote service.

## Contact

Questions or concerns: [christian.gintenreiter@gmail.com](mailto:christian.gintenreiter@gmail.com)
