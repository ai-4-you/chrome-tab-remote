# Chrome Extension Marketplace and Enterprise Trust

> Researched: 2026-08-02 · project distribution decision clarified 2026-08-04
> Scope: signing, Chrome Web Store publication, enterprise deployment, permissions, privacy, and the native messaging host.
> Project decision: v1 uses a **public Web Store listing** per the canonical [signed-publishing plan](./cws-signed-publishing-plan.md). Private/domain publication below remains an enterprise option, not the chosen v1 route.

## Conclusion

The strongest trust path for Chrome Tab Remote is:

```text
Company-controlled source and build
        ↓
Chrome Web Store publisher account
        ↓
Verified CRX Uploads + Chrome Web Store review
        ↓
Private/domain publication or approved organization publication
        ↓
Chrome Enterprise allowlist/force-install policy
        ↓
Separately signed native-host deployment
```

A Chrome Web Store listing is useful evidence of controlled distribution and policy review, but it is not a complete enterprise security certification. The organization must review the extension's permissions, data flows, native host, update process, and operational controls itself.

## Chrome Web Store controls

### Publication and updates

The publisher uploads a complete ZIP package, increments the manifest version, and submits each update for review. Chrome Web Store then distributes updates to users.

Chrome provides **Verified CRX Uploads** as an additional update-protection layer. After opting in, package updates must be signed with a publisher-controlled RSA key. This reduces the impact of a compromised Chrome Web Store developer account. The private key must be protected as a high-value release credential.

Sources:

- [Publish in the Chrome Web Store](https://developer.chrome.com/docs/webstore/publish)
- [Update a Chrome Web Store item](https://developer.chrome.com/docs/webstore/update/)

### Publisher identity and review

The publisher account should use a company-controlled identity, verified contact email, strong authentication, and separated release responsibilities. An organization should provide accurate publisher, support, privacy, and testing information.

The Web Store performs automated review and may perform manual review, especially for sensitive permissions. The Established Publisher badge can provide an additional identity and track-record signal once the publisher qualifies.

Neither review nor a badge replaces the organization's own security assessment.

Sources:

- [Set up the developer account](https://developer.chrome.com/docs/webstore/set-up-account)
- [Chrome Web Store discovery and publisher badges](https://developer.chrome.com/docs/webstore/discovery)
- [Chrome Web Store Program Policies](https://developer.chrome.com/docs/webstore/program-policies/policies)

## Enterprise distribution

For a Google Workspace organization, **domain publishing** makes an extension available through that organization's private Chrome Web Store. For a publisher serving a specific customer organization, approved external-organization publishing can provide similarly restricted visibility.

For managed Chrome, administrators can use enterprise policies to:

- allowlist or block extensions;
- force-install an approved extension;
- apply settings by organizational unit or group;
- block disallowed permissions;
- restrict extension interaction with specific hosts;
- require a minimum extension version; and
- pilot deployment before wider rollout.

Recommended rollout:

```text
Security review → pilot organizational unit → verify chrome://policy
→ staged deployment → wider rollout → monitored updates
```

An unlisted Web Store item is not equivalent to private enterprise publication: anyone with its URL may be able to install it.

Sources:

- [Enterprise publishing options](https://developer.chrome.com/docs/webstore/cws-enterprise)
- [Configure ExtensionSettings policy](https://support.google.com/chrome/a/answer/9296680)
- [Automatically install apps and extensions](https://support.google.com/chrome/a/answer/6306504)

## Permissions and privacy

Chrome recommends least privilege:

- request only permissions required by the current single purpose;
- prefer optional permissions when functionality permits;
- use `activeTab` when temporary access after an explicit user gesture is sufficient; and
- avoid broad host permissions when a narrower runtime grant is possible.

The Web Store listing must clearly state the extension's single purpose, justify every manifest permission, declare remote-code use, disclose data handling, certify applicable limited-use practices, and link to an accurate privacy policy.

Sources:

- [Declare permissions](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions)
- [The activeTab permission](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)
- [Permission warning guidelines](https://developer.chrome.com/docs/extensions/develop/concepts/permission-warnings)
- [Fill out the privacy fields](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)

## Native messaging is a separate trust boundary

The Web Store distributes and updates the extension; it does not automatically distribute or validate the native messaging host. The native host therefore needs its own enterprise-grade release path.

The native-host deployment should:

- distribute a separately signed binary;
- use a managed installer or software deployment system;
- install the native-host manifest through an approved system mechanism;
- set `allowed_origins` to the exact Web Store extension origin and ID;
- support the organization's operating systems;
- provide versioning, uninstall, rollback, and integrity evidence; and
- document what data crosses the extension/native-host boundary.

Chrome requires `allowed_origins` to be an explicit extension-origin allowlist; wildcards are not permitted.

Source:

- [Native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)

## Fit with the current repository

Existing choices that align well with enterprise review:

- Manifest V3.
- No `<all_urls>` permission.
- No install-time host permissions.
- Runtime, per-origin host permission requests.
- `activeTab` support.
- One-tab capability grants with expiry and revocation.
- Explicit approval for consequential actions.
- Local append-only audit log.
- No cloud service, tracking, or embedded AI.
- Local MCP endpoint bound to loopback with DNS-rebinding protection.

Current enterprise-readiness gaps:

- The native helper is still run from the repository rather than shipped as a signed product binary.
- The installer is currently macOS-only.
- The local MCP endpoint has no authentication; another local process could reach it while a grant is active.
- A complete release pipeline, artifact provenance, SBOM, rollback process, and incident-response package are not yet documented.

## Security-review package

Before requesting organizational approval, prepare:

1. A permission-to-feature matrix.
2. An extension/native-host data-flow diagram.
3. A threat model and trust-boundary description.
4. Source and build provenance.
5. Dependency and SBOM information.
6. The Web Store privacy policy and data-use declarations.
7. Update, rollback, and emergency-disable procedures.
8. Native-host installer and code-signing details.
9. Support and incident-response contacts.
10. A clear statement of the local MCP authentication limitation.

## Distribution guidance and project decision

General enterprise guidance remains: for a single organization, private/domain-published Web Store distribution with Chrome Enterprise policy deployment can reduce visibility; for multiple customer organizations, approved organization publishing may fit where available.

**Project decision for v1:** publish publicly. This keeps broad installation and managed force-install by ID available. It does not make the native helper enterprise-ready or replace customer security review.

In all cases, treat the separately signed native host and its installer as an equally important approval surface.
