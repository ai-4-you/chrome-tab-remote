# Research: Trusted Chrome Tab Control and Agentic Browser Access

## Current status

**Status:** Research checkpoint complete; architecture selection is intentionally pending.

**Last updated:** 2026-08-02 UTC

**Current conclusion:** The requested product is technically feasible with Chrome MV3 APIs and existing open-source agent components, but no inspected project currently satisfies the desired security boundary out of the box. The safest direction is a browser-enforced capability model with typed actions, explicit approvals, and local-first or customer-controlled deployment. This remains a working conclusion, not a final architecture decision.

**Blocking decisions before implementation:**

1. Scope boundary: one explicitly selected tab, allowed domains, allowed page types, or a combination.
2. Backend boundary: local-only, customer self-hosted, or SaaS.

**Evidence status:** Chrome/API and local-repository claims are source- or file-backed. Candidate suitability, legal applicability, and exact enterprise deployment behavior remain deployment-specific or marked `Unverified` below.

## Research request (verbatim)

> I want you to do a proper web search on this topic and idea. Check if there are already projects that do something like this. Check what Google Chrome does on that matter already and when it will be available in Europe.
>
> Find learnings about this endeavor that we might be able to build on and use for ourselves.
>
> Find similar or exactly the same open source projects on GitHub that we might just use for this or build on them to make it match our requirements better.
>
> Start now by creating a markdown file for this research. Put my request there in a vettim form and add to that file whenever you get any new information from web search and Note down references for later iterations.

## Working scope

- Trusted, security-focused Chrome extension.
- User explicitly selects which real browser tab/page may be inspected or controlled.
- Backend/agentic system can obtain page information and control the selected page.
- Suitable for enterprise adoption and policy control.
- Investigate existing products, Chrome-native capabilities and European availability, reusable open-source GitHub projects, architecture/security learnings, and licensing/operational constraints.

## Research log

### 2026-08-02 — Initial web research

> **Date note:** Search results and official pages currently describe the state as of August 2, 2026. Re-check rollout claims before making product or launch commitments.

#### 1. Google Chrome already has an adjacent native capability

Google documents **Gemini in Chrome** and an experimental **auto browse** mode. Auto browse can perform multi-step tasks such as shopping, travel booking, reservations, ticket searches, drafting communications, and administrative web work. It can use the local Chrome browser and logged-in sites, or a separate remote browser in some circumstances.

Important limitations and trust implications:

- Auto browse is experimental and gradually released.
- The documented requirements for auto browse include age 18+, United States availability, English device language, the latest Chrome, a personal Google Account, and Google AI Pro or Ultra.
- Google explicitly warns about prompt injection, unintended actions, sensitive information disclosure, and mistakes such as wrong clicks or purchases.
- Users can stop a task and take over the tab; Google describes a handoff/resume interaction.
- Google states that auto browse can work across open tabs and access the same signed-in sites as the user. This is broader than the requested product’s “one explicitly selected tab” trust boundary.

**Europe status:** The general Gemini in Chrome availability page lists the United Kingdom and some European countries/territories, but the auto browse page specifically says auto browse requires the United States. The sources do **not** announce a European auto browse date. Therefore, “Gemini in Chrome available in Europe” must not be treated as “Google’s local tab-controlling auto browse is available in Europe.”

#### 2. Chrome extension APIs provide the building blocks today

Chrome’s `tabs` API can query and manipulate tabs, navigate/reload them, capture the visible tab, and communicate with content scripts. Sensitive tab metadata (`url`, `title`, etc.) requires the `tabs` permission or relevant host permissions.

Relevant design consequences:

- A selected-tab model is implementable with `chrome.tabs.query()` plus an explicit user gesture and a stored tab ID.
- Host permissions should be narrowly scoped or requested at runtime rather than using unrestricted `<all_urls>` by default.
- The `debugger` API exposes the Chrome DevTools Protocol to extensions, but it is powerful and should be avoided unless DOM/content-script APIs are insufficient.
- `tabCapture` is user-gesture-oriented and can capture the current tab’s visible content/audio; it is not the primary mechanism for DOM-level agent control.
- MV3 permissions and Chrome Web Store/enterprise policy constraints are central to user trust and deployability.

#### 3. Reusable open-source projects identified

| Project | What it offers | Relevance / limitation |
|---|---|---|
| [browser-use/browser-use](https://github.com/browser-use/browser-use) | Python browser-agent framework with DOM-oriented actions, Chrome/session support, and local/cloud modes. | Strong agent/action layer to study or integrate. Its default model is broader browser automation; selected-tab isolation and enterprise policy boundaries would need to be added and audited. |
| [nanobrowser/nanobrowser](https://github.com/nanobrowser/nanobrowser) | Open-source Chrome extension with planner/navigator agents, DOM extraction, actions, history, and explicit guardrails/sanitization code. | Closest architectural reference for an extension-resident agent. Review license, provider/data flow, permissions, prompt-injection defenses, and whether its current tab scope is sufficiently strict. |
| [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp) | MCP server using Playwright accessibility snapshots and deterministic structured actions rather than screenshots. | Good backend/agent protocol and page representation. The core server generally launches/manages Playwright browser contexts; an existing-profile/selected-real-tab bridge must be verified separately. |
| [automaapp/automa](https://github.com/AutomaApp/automa) | Open-source visual Chrome workflow automation extension. | Useful for extension UX, workflow/action modeling, and permissions; not an AI security architecture by itself. |
| [browserbase/stagehand](https://github.com/browserbase/stagehand) | TypeScript agentic browser automation framework with structured actions and extraction. | Useful for deterministic agent primitives and evaluation patterns; designed primarily around Playwright-managed browsers rather than a user-selected real tab. |

#### 4. Emerging product/architecture pattern

The strongest reusable split is:

```text
User gesture + selected tab
        -> MV3 extension policy gate
        -> constrained page observation/action adapter
        -> local or authenticated backend/MCP bridge
        -> agent planner
        -> approval gate for consequential actions
```

A security-focused implementation should make the selected tab an explicit capability token, not merely “whatever tab is active when a command arrives.” It should also treat page content as untrusted input because Google’s own documentation identifies prompt injection as a primary agent risk.

## References

- Google Support — [Ask Gemini in Chrome to complete tasks for you with auto browse](https://support.google.com/chrome/answer/16821166?hl=en) — auto browse capabilities, requirements, risks, stop/takeover behavior, and local browser access.
- Google Support — [Gemini in Chrome availability](https://support.google.com/chrome/answer/17140089?hl=en) — supported regions/languages and general rollout status.
- Google Blog — [We’re expanding Gemini in Chrome to users in the U.K.](https://blog.google/products-and-platforms/products/chrome/were-expanding-gemini-in-chrome-to-users-in-the-uk/) — rollout announcement.
- Chrome for Developers — [`chrome.tabs`](https://developer.chrome.com/docs/extensions/reference/api/tabs) — tab querying, manipulation, capture, messaging, and permissions.
- Chrome for Developers — [`chrome.debugger`](https://developer.chrome.com/docs/extensions/reference/api/debugger) — DevTools Protocol access from extensions.
- Chrome for Developers — [`chrome.tabCapture`](https://developer.chrome.com/docs/extensions/reference/api/tabCapture) — user-initiated tab media capture.
- GitHub — [browser-use/browser-use](https://github.com/browser-use/browser-use).
- GitHub — [nanobrowser/nanobrowser](https://github.com/nanobrowser/nanobrowser).
- GitHub — [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp).
- GitHub — [AutomaApp/automa](https://github.com/AutomaApp/automa).
- GitHub — [browserbase/stagehand](https://github.com/browserbase/stagehand).

## Open questions

- What exact page types and actions should be supported?
- Should the backend be local, self-hosted, or SaaS?
- What enterprise controls are mandatory (allowlists, audit logs, SSO, data residency, DLP)?
- What does “available in Europe” refer to: a Chrome feature, an agent product, or both?
- **Blocking architecture question:** Does “selected” mean one explicitly selected tab, an allowed page type, an allowed domain, or a combination?
- **Blocking deployment question:** Should the backend be local-only, self-hosted by each customer, or SaaS?

## Research log — continuation

### 2026-08-02 — Gap review and local baseline inspection

#### Local reference: `~/dev/chrome-tracker`

The prototype is materially broader than the desired trust model:

- `tracker/manifest.json` uses `host_permissions: ["<all_urls>"]` and content scripts matching all URLs, with a long exclusion list.
- It requests high-impact permissions including `tabs`, `scripting`, `webRequest`, `downloads`, `offscreen`, and `sidePanel`.
- `tracker/background.js` stores activity, page content, and user actions in IndexedDB, then sends them to a configurable knowledge server using an API key.
- Operation polling selects the current active tab when no operation-specific `tabId` is supplied. This is a race-prone fallback and does not establish a durable user-approved capability for one tab.
- The prototype is therefore useful as a functional baseline, but not as a security baseline. The new design should default-deny, avoid global tracking, bind every operation to an explicit capability, and make outbound data minimization/audit behavior visible.

#### `agent-browser` findings

The installed CLI (**agent-browser 0.27.0**, verified with `agent-browser --version` and `agent-browser -h`) supports both a separate managed browser and attachment to an existing Chrome session via `connect <port|url>`, `--cdp`, and `--auto-connect`. It also exposes directly reusable safety controls: `--allowed-domains`, `--action-policy`, `--confirm-actions`, `--confirm-interactive`, and content-boundary output. This is a useful reference for the backend/agent interaction model, but CDP attachment is not equivalent to a Chrome-extension tab capability and must not be assumed to provide the desired enterprise isolation.

#### Candidate scorecard (file-level evidence)

**Criteria:** License is based on the repository license file; permissions/scope on manifests; selected-tab support requires explicit evidence of durable user-selected targeting; outbound-data findings require privacy documentation or code evidence; reuse assessment is qualitative and not a substitute for a security audit. No numerical weighting is applied yet because the two blocking architecture decisions are unresolved.

| Candidate | License | Extension permissions / scope | Existing selected real tab | Outbound data / telemetry | Initial reuse assessment |
|---|---|---|---|---|---|
| `nanobrowser/nanobrowser` | Apache-2.0 (`LICENSE`) | **Verified broad:** `<all_urls>`, `scripting`, `tabs`, `activeTab`, `debugger`, `webNavigation`; content scripts run on all web URLs (`chrome-extension/manifest.js`). | **Unverified as user-selected:** code queries the active tab and stores a current tab ID; no evidence yet of a durable user-selected capability boundary. | **Verified:** optional analytics is enabled by default per `PRIVACY.md`; code includes PostHog analytics. Its privacy policy says page HTML/screenshots are sent to the chosen LLM provider. | Best extension architecture reference, but requires a serious permission, analytics, data-flow, and capability-boundary reduction before enterprise reuse. |
| `browser-use/browser-use` | MIT (`LICENSE`) | Not an extension candidate based on inspected repository structure. | **Unverified** for a real user-selected extension tab; primarily an agent/browser framework. | Provider/cloud behavior requires separate audit. | Potential agent/action layer, not a drop-in extension foundation. |
| `microsoft/playwright-mcp` | Apache-2.0 (`LICENSE`) | MCP server, not a Chrome extension manifest. | **Unverified** for a selected existing user tab from the inspected README. | MCP client/server data flow and model-provider handling require deployment-specific audit. | Strong structured automation protocol/reference; needs an extension bridge. |
| `browserbase/stagehand` | MIT (`LICENSE`) | Not a Chrome extension manifest. | **Unverified** for a selected existing user tab. | Deployment/provider behavior requires audit. | Useful TypeScript agent primitives, not the browser trust boundary. |
| `AutomaApp/automa` | License not verified in this pass; repository path is `AutomaApp/automa`. | **Verified broad in development manifest:** `<all_urls>` host/content matches, `activeTab`, and debugger APIs; workflow engine can operate multiple tab IDs. | **Partial:** supports an active-tab workflow model, but no evidence yet of the proposed security capability and backend approval protocol. | Webhook/network actions are present; exact telemetry/data policy remains unverified. | Useful workflow/action UX reference, not a safe default foundation. |

#### Enterprise deployment and policy findings

Chrome Enterprise documents an `ExtensionSettings` policy surface. The policy catalog includes runtime host controls such as `runtime_allowed_hosts` and `runtime_blocked_hosts`, alongside extension installation and management controls. This creates a viable enterprise pattern: customer administrators can restrict where an extension may operate independently of the extension’s own product UI.

Chrome Enterprise also supports managed extension installation/configuration, including force-install and allow/block controls. A private or enterprise-distributed extension can therefore be deployed through customer policy rather than relying only on public Chrome Web Store discovery. Exact distribution configuration must be validated per OS and customer management mode.

#### MV3 and Chrome Web Store constraints

- Chrome Web Store privacy policy rules require an accurate, current privacy policy when an extension handles user data, including how data is collected, used, shared, and all parties receiving it.
- Manifest V3 prohibits remotely hosted executable code. A backend may return data such as JSON action plans, but the extension must not download and execute JavaScript/WASM as code. This needs build-output and dependency auditing.
- MV3 service workers are disposable: Chrome normally terminates them after about 30 seconds of inactivity, after a handler/API call exceeds five minutes, or after a fetch response exceeds 30 seconds. State must be persisted, and long-running agent sessions need explicit reconnection/resumption design.
- Chrome documents that active debugger sessions and WebSocket/message patterns affect service-worker lifetime in particular Chrome versions. These are implementation details to test, not a substitute for durable state.

#### EU privacy and workplace implications

**Legal caveat:** This is engineering research, not legal advice. GDPR, employment law, works-council obligations, sector rules, and international-transfer requirements must be reviewed for the actual deployment countries, customer role, data flows, and workforce context.

The European Commission’s controller/processor guidance is directly relevant: the party deciding why and how page data is processed is a controller; a service provider processing data on its behalf may be a processor. Sending authenticated page content to an agent backend therefore requires a deployment-specific role analysis, transparency, purpose limitation, retention, access-control, and international-transfer review.

For Germany, §87(1) no. 6 BetrVG gives the works council co-determination over technical facilities intended to monitor employee behavior or performance. A browser extension that records browsing, page content, or user actions can trigger this issue in workplace deployments; legal review is required rather than treating enterprise trust as only a technical feature.

#### New practical learnings

1. **Capability isolation should be stricter than active-tab lookup.** Store a signed/ephemeral grant containing tab ID, origin/policy, user identity, expiry, and allowed action classes. Revalidate it after navigation, tab replacement, extension restart, and backend reconnect.
2. **Use the browser as the policy enforcement point.** The backend should propose typed actions; the extension should validate target tab, origin, action class, and user approval before execution.
3. **Start with local-first or self-hosted deployments.** This reduces the initial controller/processor and data-residency surface compared with sending authenticated page data to a multi-tenant SaaS backend.
4. **Treat the prototype’s broad permissions as migration debt.** Runtime host permissions, `activeTab`, narrowly scoped content scripts, and managed host policies are preferable to `<all_urls>` plus exclusions.
5. **Separate page observation from action authority.** Reading a page and submitting a purchase/form should not share the same unrestricted permission or approval path.

## References — continuation

- Local baseline: [`~/dev/chrome-tracker/tracker/manifest.json`](file:///Users/cgint/dev/chrome-tracker/tracker/manifest.json) and [`background.js`](file:///Users/cgint/dev/chrome-tracker/tracker/background.js).
- Local CLI: [`agent-browser` help](https://www.agent-browser.dev/) — verified locally with `agent-browser -h` and `agent-browser --version` (`0.27.0`) on 2026-08-02.
- Chrome Enterprise — [Extension Settings policy](https://chromeenterprise.google/policies/extension-settings/).
- Chrome Enterprise — [Chrome policy list](https://chromeenterprise.google/policies/).
- Chrome Web Store — [Privacy policies](https://developer.chrome.com/docs/webstore/program-policies/privacy).
- Chrome Web Store — [Program policies](https://developer.chrome.com/docs/webstore/program-policies).
- Chrome for Developers — [Deal with remote hosted code violations](https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code).
- Chrome for Developers — [Extension service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle).
- European Commission — [What is a data controller or a data processor?](https://commission.europa.eu/law/law-topic/data-protection/rules-business-and-organisations/obligations/controllerprocessor/what-data-controller-or-data-processor_en).
- European Commission — [Information for people whose data is collected](https://commission.europa.eu/law/law-topic/data-protection/rules-business-and-organisations/principles-gdpr/what-information-must-be-given-individuals-whose-data-collected_en).
- German law — [§87 BetrVG](https://www.gesetze-im-internet.de/betrvg/__87.html).
- Chrome for Developers — [Stay secure](https://developer.chrome.com/docs/extensions/develop/security-privacy/stay-secure).
- Chrome for Developers — [Protect user privacy](https://developer.chrome.com/docs/extensions/develop/security-privacy/user-privacy).
- Chrome for Developers — [Improve extension security](https://developer.chrome.com/docs/extensions/develop/migrate/improve-security).
- OWASP GenAI Security Project — [LLM01:2025 Prompt Injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/).

## Security and trust review

### Trust model used for this review

“Trusted” does not mean “secure by default.” It means the claim is supported by an authoritative primary source or directly reproducible local evidence. Security suitability is a separate judgment and requires code audit, threat modeling, testing, and operational controls.

| Finding area | Trust level | What can be trusted | What cannot yet be trusted |
|---|---|---|---|
| Chrome MV3 API capabilities and lifecycle | **High for documented behavior** | Chrome’s official documentation for permissions, `activeTab`, service-worker lifecycle, messaging, content scripts, HTTPS, CSP, and remote-code rules. | That an implementation using these APIs is automatically secure; browser/version edge cases still require tests. |
| Chrome Enterprise policy surface | **High for policy existence; medium for deployment fit** | Official documentation that `ExtensionSettings` and runtime host controls exist. | That every customer’s OS, Chrome management mode, and policy configuration will behave identically; this requires customer-environment validation. |
| Chrome Web Store/privacy rules | **High for published rules** | Official requirements for privacy disclosures, single-purpose behavior, permissions, and bundled executable code. | Store approval as proof of enterprise security. Store review is not a penetration test or a customer threat-model review. |
| Google Gemini in Chrome / auto browse | **High for stated current requirements** | Google’s own stated capabilities, warnings, and documented availability requirements as of the research date. | Any European launch date; none was found. Also, Google’s feature is not evidence that our narrower trust model is safe. |
| Local `chrome-tracker` behavior | **High for inspected code facts** | The manifest and `background.js` directly demonstrate broad permissions, IndexedDB storage, server sync, and active-tab fallback. | Its security posture beyond inspected files; this was not a full audit. |
| `agent-browser` capabilities | **High for installed CLI facts** | Version `0.27.0`, attachment options, allowlists, action policies, and confirmation flags shown by local help. | Its suitability as a Chrome-extension security boundary; CDP attachment has a different privilege model. |
| Open-source repository licenses/manifests | **High for inspected files** | The exact license files and manifest permissions recorded in the scorecard. | Maintenance quality, supply-chain safety, complete data flow, and enterprise readiness without deeper audit. |
| Candidate project suitability | **Low to medium** | They are useful references and some contain relevant primitives. | Claims that any candidate is safe to adopt directly, especially `nanobrowser`, whose inspected defaults are broad and include analytics/provider data flow. |
| GDPR / German works-council implications | **High for the cited legal text; low for deployment conclusion** | The Commission’s controller/processor concepts and §87(1) no. 6 BetrVG text. | A definitive legal classification for this product or customer; that requires qualified legal advice and deployment facts. |
| Prompt-injection mitigations | **High for threat existence and recommended controls** | OWASP documents indirect prompt injection, least privilege, typed/validated outputs, human approval, separation of untrusted content, and adversarial testing. | Any claim that prompt injection can be completely prevented. It cannot currently be treated as solved by prompting alone. |

### What the evidence supports for an enterprise-trust product

The most defensible requirements are:

1. **Single purpose and least privilege:** Do not start from `<all_urls>`, broad `debugger`, or global tracking. Use `activeTab`, optional host permissions, narrowly scoped content scripts, and managed host restrictions where possible.
2. **Browser-enforced authority:** The backend/LLM must never directly decide or execute arbitrary browser operations. It may return a typed proposal; the extension validates the capability, current tab/origin, action class, and user approval.
3. **Separate observation from consequential action:** Reading/summarizing a page, entering text, submitting a form, downloading, purchasing, sending a message, and navigating to a new origin need separate action classes and approval policies.
4. **Untrusted-page boundary:** Treat all page text, DOM attributes, images, documents, tool results, and backend-returned content as untrusted data—not instructions. Prompting alone is not a security control.
5. **Supply-chain and release trust:** Protect publisher accounts with strong MFA/security keys, use reproducible builds and dependency review, sign/review releases, maintain a rollback path, and publish an incident/vulnerability-reporting process.
6. **Data minimization and customer control:** Keep page content local by default, disclose every recipient/provider, make telemetry opt-in or remove it, define retention/deletion, and support customer-controlled endpoints and audit logs.
7. **Enterprise policy compatibility:** Provide an administrator policy surface for allowed origins, blocked origins, enabled action classes, model/backend endpoints, retention, and emergency disablement.
8. **Evidence before trust claims:** Require permission review, threat modeling, adversarial prompt-injection tests, extension security tests, dependency/SBOM review, and an external security review before claiming enterprise readiness.

### Security objections to current candidate reuse

- **Nanobrowser:** Useful code reference, but **not trusted as an enterprise foundation without modification**. Its inspected manifest requests `<all_urls>` and `debugger`; its privacy policy says analytics is enabled by default and page HTML/screenshots may be sent to the selected LLM provider. Those defaults conflict directly with the narrow, corporation-friendly trust goal.
- **Chrome-tracker:** **Not trusted as a security foundation.** It demonstrates the desired functional direction but uses broad permissions, global content scripts, persistent activity/content/action capture, and an active-tab fallback for remote operations.
- **Automa:** **Not trusted as an AI security foundation.** It is a useful workflow/action reference, but its inspected development manifest is broad and its exact telemetry/data posture was not verified.
- **browser-use, Stagehand, Playwright MCP:** **Not trusted as complete extension foundations.** Their licenses and automation abstractions are useful, but the inspected evidence does not establish a selected-real-tab capability boundary or enterprise data-flow controls.

### Bottom line

The most trustworthy findings are the **official Chrome security/API constraints, official Enterprise policy capabilities, directly inspected local code, and OWASP threat guidance**. The least trustworthy findings are broad statements about candidate suitability, enterprise readiness, or “secure” behavior inferred from repository descriptions. At this stage, reuse should mean extracting reviewed primitives—not importing a project wholesale.

## Decision framing for the next iteration

### Scope boundary

| Option | Benefit | Cost / risk | Evidence needed |
|---|---|---|---|
| Explicitly selected tab only | Strongest user-visible trust boundary; easiest to explain and audit. | Breaks when the tab navigates, closes, or spawns a related tab; requires capability renewal. | Define navigation, popup, iframe, and tab-replacement behavior. |
| Allowed domains/page types | Better workflow continuity and enterprise policy alignment. | A domain can contain unrelated sensitive pages; weaker than tab-level consent. | Identify supported sites and required page classification. |
| Combined model | Tab grant plus domain/page policy gives defense in depth. | More UX and policy complexity. | Confirm whether the product needs continuity across navigation. |

**Working recommendation:** Start with the combined model, but make the explicit tab grant the mandatory minimum. This is not final until the product’s supported workflows are known.

### Backend boundary

| Option | Benefit | Cost / risk | Evidence needed |
|---|---|---|---|
| Local-only | Lowest data-transfer and enterprise trust surface; works with sensitive pages. | Harder operations, updates, support, and multi-user coordination. | Confirm acceptable local runtime and model/provider requirements. |
| Customer self-hosted | Customer controls data location and network boundary. | Deployment and upgrade burden; customer must operate the service securely. | Identify target customer IT capabilities and required integrations. |
| SaaS | Fastest centralized product iteration and support. | Highest data-protection, residency, breach-impact, and trust burden. | Define data minimization, tenancy, retention, region hosting, and contractual roles. |

**Working recommendation:** Prototype local-only or self-hosted first; consider SaaS only after the data-flow and enterprise-control requirements are explicit.
