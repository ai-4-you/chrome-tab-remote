# CWS Privacy Practices — Copy-Paste Values

> Generated 2026-08-26. Paste each block into the corresponding field on the
> Chrome Web Store **Privacy** tab. All fields are within the 1 000-char limit.

---

## Single purpose description

```
Chrome Tab Remote gives the user control over exactly one browser tab they explicitly select. The agent can read that tab's content (text, structure, interactive elements) and, only if the user opts in, perform individual actions (click, fill, select) — each requiring explicit per-action approval in the side panel. Access is origin-pinned (suspends automatically if the tab navigates to a different site), time-boxed (30-minute expiry), and revocable at any time. All activity is recorded to a local, user-inspectable audit log. The extension contains no remote code, no analytics, and no vendor-operated cloud service.
```

*(397 chars)*

---

## Permission justifications

### activeTab

```
Granted only when the user clicks the extension's toolbar icon on a specific tab. This allows the extension to read that single tab's DOM for the initial snapshot without requiring broad host permissions upfront. No other tab is ever accessed via this permission.
```

### alarms

```
A single 1-minute repeating alarm keeps the native-messaging port alive. MV3 service workers are terminated when idle; the alarm wakes the worker to re-establish the connection to the locally-installed companion helper. The alarm carries no data and does not access page content.
```

### tabs

```
Used exclusively to enforce the per-tab consent boundary: (1) tabs.onUpdated detects when the granted tab navigates to a different origin, triggering automatic grant suspension; (2) tabs.onRemoved auto-revokes the grant when the tab is closed; (3) tabs.get and tabs.query revalidate that the granted tab still exists and remains the active tab before each tool call or screenshot. Only the explicitly granted tab is ever referenced.
```

### scripting

```
chrome.scripting.executeScript is used to inject the bundled content script (content.js) into the granted tab only, so the agent can read the page DOM (text, headings, links, form controls). The script is a static, pre-bundled file shipped inside the extension package. It is never injected into any tab other than the one the user explicitly granted.
```

### storage

```
chrome.storage.session stores active grant metadata (origin, expiry, capabilities) and is automatically cleared when the browser session ends. chrome.storage.local stores a capped audit ring-buffer (most recent 500 entries) of grant/read/action events for the user to inspect and clear in the side panel. The local helper separately appends audit.jsonl in its data directory (default ~/.chrome-tab-remote), rotating at 10 MiB and retaining one prior generation; the side-panel clear control does not clear that file. No data is sent to any remote server.
```

### sidePanel

```
The side panel is the user-facing consent and control surface: it displays the current grant state, shows the agent's audit activity for the tab, presents action-approval prompts (with a 110-second auto-deny timeout), and provides revoke/expiry controls. All user decisions happen here.
```

### nativeMessaging

```
Communicates with a locally-installed companion helper process (the MCP bridge) that the user explicitly installs via a documented one-line command. All tab data flows to 127.0.0.1 only (localhost). The helper runs a local MCP server; no data is forwarded to any external network. The native-messaging host ID is fixed and the allowed_origins list contains only this extension's Store ID.
```

### notifications

```
Displays a system notification when the agent requests an action that requires user approval, ensuring the user is alerted even when the side panel is not in focus. Clicking the notification focuses the side panel on the pending approval card. No data is transmitted externally.
```

---

## Remote code

**Select:** ☑ **No, I am not using Remote code**

No justification text needed when "No" is selected.

---

## Data usage — checkboxes

Check **only** this one:

- ☑ **Website content** — "For example: text, images, sounds, videos or hyperlinks"

Leave all others unchecked:

- ☐ Personally identifiable information
- ☐ Health information
- ☐ Financial and payment information
- ☐ Authentication information
- ☐ Personal communications
- ☐ Location
- ☐ Web history
- ☐ User activity

*Rationale:* The extension reads DOM content (text, headings, links, form values) of the single user-granted tab. It does not track browsing history, log user input events, collect PII, or access any of the other listed categories.

---

## Certifications

Check all three:

- ☑ I do not sell or transfer user data to third parties, apart from the approved use cases
- ☑ I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- ☑ I do not use or transfer user data to determine creditworthiness or for lending purposes

---

## Privacy Policy URL

You need a public URL. Two options:

**Option A (recommended):** Host a one-page policy via GitHub Pages:
```
https://ai-4-you.github.io/chrome-tab-remote/
```
(I can generate the `privacy.html` for the repo if you want.)

**Option B (quick):** Link directly to a privacy section in the README:
```
https://github.com/ai-4-you/chrome-tab-remote#privacy
```
(Less ideal — CWS reviewers prefer a standalone policy page.)

---

## What to paste where (quick map)

| Form field | Section above |
|---|---|
| Single purpose description | § Single purpose |
| activeTab justification | § activeTab |
| alarms justification | § alarms |
| tabs justification | § tabs |
| scripting justification | § scripting |
| storage justification | § storage |
| sidePanel justification | § sidePanel |
| nativeMessaging justification | § nativeMessaging |
| notifications justification | § notifications |
| Remote code | Select "No" |
| Data usage checkboxes | Check "Website content" only |
| Certifications | Check all 3 |
| Privacy Policy URL | Your hosted URL |

---

*After filling all fields, click **Save draft** at the bottom of the Privacy tab, then return to the main item page and retry Publish.*
