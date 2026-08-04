# Chrome Web Store signed-publishing plan

> **Canonical publication plan** · as-of 2026-08-04 · status: **planning; no submission started**
>
> Scope: public Chrome Web Store publication of the extension, permanent Store-ID alignment with the native host, and signed future updates through Verified CRX Uploads. Full enterprise certification and cross-platform native-host productisation remain a separate delivery track.
>
> Traceability boundary: this is a release-process plan, not a new runtime capability, so it adds no numbered `REQUIREMENTS.md` behavior IDs. Any later implementation that changes permissions, consent, data flow, or runtime behavior must update `REQUIREMENTS.md` in the same commit.

## Outcome

Publish the extension honestly through the public Chrome Web Store, using **AI Tab Grant** as the working Store-facing name pending one batched human confirmation, then protect future package uploads with a publisher-controlled Verified CRX Uploads key. Automate deterministic engineering work; batch the few unavoidable human actions into short guided sessions.

This plan does **not** claim that Store approval proves enterprise security. It does not bypass review, conceal permissions, automate legal declarations, or treat a screencast as a substitute for working software.

## Current position

The extension is functionally mature, but the release path is not ready.

| Area | Evidence as of 2026-08-04 | Status |
|---|---|---|
| Product behavior | 231/231 tests pass; typecheck and lint pass | Ready baseline |
| Dependency gate | `./precommit.sh` fails because `hono <4.12.34` has a moderate ReDoS advisory | **Blocking** |
| Distribution decision | Existing 2026-08-02 analysis selected a public listing; enterprise policy can still force-install a public item by ID | Decided for v1 |
| Publisher identity | No permanent publisher account owner, recovery arrangement, or strong-authentication evidence is recorded | Confirm in H1 |
| Store-facing name | Existing 2026-08-02 analysis selected **AI Tab Grant**; explicit current-user confirmation is not recorded, and code still says Chrome Tab Remote | Confirm in the pre-Stage-2 decision reply |
| Package | Build exists; no deterministic submission ZIP command or artifact verifier | **Blocking** |
| Version | Manifest is `0.1.0`; extension package is `0.0.0` | **Blocking** |
| Extension identity | Manifest pins a development public key; the native host allowlists the resulting ID | Draft Store identity required |
| Reviewer experience | Panel says only `disconnected`; helper requires this repo, Node, a build, and a macOS-only installer | **Highest rejection risk** |
| Privacy | No public policy URL or finalized dashboard disclosures | **Blocking** |
| Listing assets | 128×128 icon exists; its artwork padding is unverified. Existing screenshot is 1322×1630, not an accepted Store screenshot size. Required 440×280 promo image is absent | **Blocking** |
| Signing | Verified CRX Uploads selected for future updates; private-key custody is undecided | Post-first-publication gate |
| Planning state | Canonical plan and reconciled CWS companion documents are committed; semantic reconciliation is complete; no publication implementation has started | Stage 0 complete |

## Fixed principles and corrected assumptions

1. **Public v1; enterprise remains separate.** Chrome Enterprise supports managed installation of approved Store items ([Google Admin help](https://support.google.com/chrome/a/answer/6306504)), so public v1 preserves a force-install path by ID. Store review is distribution/policy evidence, not enterprise certification.
2. **The first submission is a ZIP.** Google's [publish guidance](https://developer.chrome.com/docs/webstore/publish) documents the ZIP package, while [Verified Uploads guidance](https://developer.chrome.com/blog/verified-uploads-cws) applies publisher-key verification to future uploads. Therefore signing-key custody should not delay the initial submission path.
3. **Two different keys exist.** Google's [`manifest.key` guidance](https://developer.chrome.com/docs/extensions/reference/manifest/key) covers the Store item identity key; [Verified Uploads guidance](https://developer.chrome.com/blog/verified-uploads-cws) covers the publisher-controlled future-upload key. Do not conflate them:

   ```text
   Chrome Web Store item key
   - Google-controlled signing identity
   - public key may be placed in manifest.json
   - determines/preserves extension ID for local and Store builds
   - not secret

   Verified CRX Uploads key
   - publisher-controlled RSA key pair
   - private key signs future upload CRXs
   - public key is registered in the Developer Dashboard
   - high-value secret; never committed or pasted into chat
   - Google verifies the upload, then repackages it with the existing Store key
   - extension ID remains unchanged
   ```

4. **Review time is not a commitment.** Google's [review-process guidance](https://developer.chrome.com/docs/webstore/review-process) says most reviews complete within a few days but some take up to a few weeks, and lists new developers/extensions, dangerous permissions, broad host patterns, and hard-to-review code as closer-review signals. Use “days to a few weeks” only as a planning buffer.
5. **The 440×280 promotional image is required.** Google's [image requirements](https://developer.chrome.com/docs/webstore/images) require the 128×128 icon, a small 440×280 promotional image, and at least one 1280×800 or 640×400 screenshot.
6. **Local bridge does not mean guaranteed local downstream processing.** The extension communicates with the local native helper and does not itself embed an AI or vendor cloud service. The user-selected MCP client may forward tool results to an external model. Listing and privacy text must describe this boundary and must not promise that data can never leave the machine.
7. **No reviewer tricks.** A screencast and detailed notes explain setup; they do not replace a comprehensible missing-helper state and a reproducible helper-install path.

## Minimal-human operating model

Human work is concentrated into one short pre-Stage-2 decision reply and three guided operational batches. Everything else is prepared and verified beforehand.

```text
Agent/repo work ──▶ H1: account + draft ──▶ Agent/repo work
                                      │
                                      ▼
                         H2: listing certification + submit
                                      │
                                      ▼
                         Review response, if any
                                      │
                                      ▼
                         H3: Verified Uploads opt-in
```

### Pre-Stage-2 decision reply

One short response, requested only when Stage 1 is green:

1. confirm **AI Tab Grant** as the final Store-facing name (recommended default);
2. accept GitHub Pages as the privacy-policy host unless an existing product domain is supplied;
3. accept the downloadable built macOS helper + explicit Node prerequisite as the minimum reviewer fallback, while preferring a self-contained bundle if implementation proves proportionate.

No account access, credentials, payment, legal certification, or signing material is involved.

### Human batch H1 — account and Store identity

Target: 20–30 focused minutes after all draft artifacts are ready.

The human:

1. confirms the permanent publisher-account owner, monitored address, recovery method, and strong authentication, then signs in;
2. accepts Google’s developer agreement and pays the one-time fee;
3. creates the draft item and uploads the prepared draft ZIP;
4. copies the dashboard Item ID and **Package → View public key** into a local handoff file or directly into the guided terminal prompt.

The agent does not handle credentials, payment details, account recovery, or acceptance of terms.

### Human batch H2 — legal certification and submission

Target: 20–30 focused minutes after every dashboard answer and asset has been prebuilt.

The human:

1. reviews and truthfully confirms the privacy/data-use declarations;
2. uploads prebuilt listing assets and pastes reviewed copy;
3. verifies distribution visibility and support contact;
4. performs the final **Submit for review** action.

The agent may guide screen-by-screen but does not click legal certifications or submit.

### Human batch H3 — signed future uploads

Target: 15–20 focused minutes after initial approval and key-custody preparation.

The human:

1. approves the signing-key custody location and authorized operators;
2. performs or observes offline key generation;
3. registers only the public key under **Package → Opt in**;
4. stores and tests the documented recovery material.

The private key never enters the repository, chat, logs, screenshots, or ordinary CI artifacts.

## Responsibility matrix

| Work | Default owner | Automation level | Approval / human boundary |
|---|---|---:|---|
| Confirm final Store name, policy host, and helper fallback | Human, agent-guided | One short reply | Before Stage 2; recommended defaults supplied |
| Inspect manifest permissions against code | Agent | Full | Permission removal changes behavior and needs approval |
| Run tests, lint, typecheck, audit | Agent/CI | Full | None |
| Build extension and create versioned ZIP | Script/CI | Full | None after implementation approval |
| Inspect ZIP allowlist, hashes, sizes, manifest, remote-code indicators | Script/CI | Full | Fails closed on mismatch |
| Generate listing/privacy/reviewer-copy drafts | Agent | High | Human reviews legal/data claims |
| Generate screenshot capture checklist and validate dimensions | Agent/script | High | Human may help with visual capture if browser automation is insufficient |
| Choose publisher owner, recovery, and strong authentication | Human | None | Never automated or inferred |
| Create Store account and pay fee | Human | None | Never automated |
| Accept developer agreement or limited-use certification | Human | None | Never automated |
| Upload first draft and retrieve Store public key/ID | Human, agent-guided | Low | Dashboard credentials remain human-controlled |
| Insert public Store key and verify ID consistency | Agent/script | Full | Public material; runtime/release edit still needs implementation approval |
| Build reviewer helper kit | Agent/script | High | Code-signing/notarization credentials remain human-controlled |
| Record reviewer screencast | Human + agent script/checklist | Medium | No secrets or unrelated browser data in recording |
| Final submission | Human | None | Never automated |
| Triage rejection notice | Agent | High | Human supplies notice; behavior/policy changes require approval |
| Generate Verified Uploads key pair | Human-controlled offline procedure | Deliberately limited | Private-key custody decision cannot be delegated |
| Sign and verify future CRX | Release script/protected CI | High | Manual approval gate; no final auto-publish |
| Upload future candidate | Initially human; later protected manual-dispatch automation may be evaluated | Medium | Credentials in protected secret store; final publish stays human |

## End-to-end stages

Each stage has an entry condition, ordered work, a completion gate, evidence, risks, and recovery. A stage is not complete because work was attempted; its gate must be satisfied.

### Stage 0 — Canonicalize the release contract — **complete 2026-08-04**

**Entry:** Current repository and existing CWS analysis are available.

**Work:**

1. Adopt this file as the canonical publication plan.
2. Mark `docs/cws-submission-readiness.md` as the detailed gap-analysis snapshot and `docs/cws-first-submission-runbook.md` as the dashboard companion, both subordinate to this plan.
3. Update `PROJECT_OVERVIEW.md`: public v1 is no longer an open distribution question; publication work has not started.
4. Clarify in `docs/chrome-extension-enterprise-trust.md` that its private/domain recommendation is a general enterprise option, superseded for this project’s public-v1 distribution decision.
5. Keep unverified claims labeled; link official sources.

**Gate:** One document names the sequence, ownership, evidence, and blocker state; companion documents do not contradict it.

**Evidence:** Path-scoped diff and link check.

**Risks:** Silently laundering untracked analysis into “decided truth.”

**Recovery:** Preserve provenance and explicitly identify which 2026-08-02 decisions are adopted versus still awaiting implementation.

---

### Stage 1 — Release-foundation slice

**Entry:** Stage 0 complete and explicit approval exists for dependency/build changes.

**Ordered work (green-red-green where behavior is involved):**

1. Reproduce the current baseline: 231 tests green; precommit red only on the known Hono advisory.
2. Update Hono through the narrowest compatible dependency path; run focused host tests and full precommit.
3. Select one version source, recommended: `packages/extension/package.json`; inject it into the built manifest.
4. Add deterministic commands:
   - `package:store-draft` — conservatively build a ZIP without the development manifest key; this first-upload behavior remains **unverified** until exercised on the draft item;
   - `package:store` — build the final ZIP with the committed public Store key;
   - `verify:store-package` — inspect contents, manifest values, hashes, file sizes, source-map absence, remote-code indicators, and forbidden files.
5. Produce a machine-readable release report with artifact path, SHA-256, version, permissions, optional host patterns, extension-ID derivation status, and verification commands.
6. Load the unpacked contents of the generated ZIP in a clean Chrome profile; never test only `dist/` from a separate build.

**Automation:** Full after implementation. CI may build and verify unsigned ZIP artifacts; no credentials needed.

**Gate:** `./precommit.sh` green; package is reproducible from a clean checkout; verifier fails on extra/missing files, wrong version, development key leakage, source maps, or changed permissions.

**Evidence:** Test output, audit output, ZIP listing, SHA-256, release report, clean-profile test record.

**Risks:** Dependency regression; non-reproducible ZIP timestamps; accidentally shipping the development key or repository files.

**Recovery:** Pin compatible versions; normalize archive ordering/timestamps; use an explicit package allowlist rather than exclusions.

---

### Stage 2 — Reviewer-safe product surface

**Entry:** Release foundation is green and the pre-Stage-2 decision reply has confirmed the Store-facing name, privacy-policy host, and minimum reviewer-helper path.

**Ordered work:**

1. Rename user-visible surfaces to **AI Tab Grant** while preserving internal native-host and storage identifiers.
2. Add a tested native-helper state that says the helper is unavailable/not installed, explains the consequence, links to public setup instructions, and offers retry/status information. Do not infer “not installed” when the error could also be a crash; wording must cover both.
3. Re-audit every permission against code. Keep only what the single purpose requires. Record precise dashboard justifications.
4. Add 16/32/48 icons and `action.default_icon`; verify the 128×128 Store icon’s transparent padding and light/dark contrast.
5. Decide and build the minimum credible reviewer helper kit:
   - preferred: downloadable, checksummed macOS bundle/installer that does not require a repository checkout;
   - minimum fallback: downloadable built helper plus explicit Node prerequisite and one installer command.
6. Keep Windows/Linux limitations explicit. Do not claim cross-platform support.

**Automation:** Tests for status rendering; icon-dimension checks; permission-to-symbol report; helper artifact build/checksum; broken-link check for setup URL.

**Gate:** On a clean machine/profile without the helper, the extension explains its state and recovery. With the documented macOS helper path, the exact release candidate completes grant → read → approve/deny → revoke.

**Evidence:** Automated tests, screenshots, helper checksum, clean-profile walkthrough log.

**Risks:** Reviewer runs Windows/Linux; reviewer declines external helper installation; broad optional hosts and `tabs`/`nativeMessaging` increase scrutiny.

**Recovery:** Reviewer notes and screencast explain the limitation honestly; if Google requires an exercisable helper on the reviewer’s platform, pause submission and productise that platform rather than simulate functionality.

---

### Stage 3 — Privacy, listing, and reviewer packet

**Entry:** Product behavior, permissions, and helper installation path are stable.

**Ordered work:**

1. Publish a public privacy policy, recommended default: GitHub Pages from this repository.
2. Prepare dashboard text for:
   - single narrow purpose;
   - every manifest permission and optional host pattern;
   - no remote executable code;
   - data types handled and local storage;
   - limited-use certification;
   - support contact.
3. Use accurate data-flow wording:

   ```text
   Granted tab content and URLs are transferred to the local companion helper
   and exposed only through its localhost MCP endpoint. The extension does not
   contain an AI model or send data to a vendor-operated cloud service. A user-
   selected MCP client or AI service may process or transmit tool results under
   that service's own configuration and privacy terms.
   ```

   Legal/policy wording requires human review before certification.
4. Prepare listing assets:
   - 128×128 PNG icon with suitable artwork padding;
   - required 440×280 small promotional image;
   - 1–5 full-bleed screenshots at exactly 1280×800 or 640×400;
   - optional 1400×560 marquee only if featuring is desired.
5. Prepare reviewer notes with helper download, checksum, supported OS, exact install/test steps, expected missing-helper state, source link, and screencast link.
6. Record one continuous clean-profile screencast without private tabs, credentials, tokens, file paths, or signing material.

**Automation:** Generate copy from a checked-in source-of-truth template; validate character counts, URLs, image dimensions, required fields, and permission parity; generate reviewer checklist and checksums.

**Gate:** Public URLs return successfully; every manifest permission has a matching justification; every disclosed data flow matches code and documentation; all images pass dimensional checks; reviewer packet reproduces the flow.

**Evidence:** Link-check output, data-flow review, image validator output, permission matrix, human sign-off on legal statements.

**Risks:** Overclaiming “no cloud”; under-disclosing page content/URLs; listing copy diverges from code; screenshots reveal personal data.

**Recovery:** Stop submission, correct the source-of-truth text/assets, regenerate dashboard material, and repeat privacy parity review.

---

### Stage 4 — Human batch H1: account, draft item, permanent identity

**Entry:** Draft ZIP passes Stage 1 verification; H1 handoff contains only the ZIP, checksum, account checklist, and public-key capture instructions.

**Ordered work:**

1. Human registers the permanent dedicated publisher account and pays the fee.
2. Human creates a draft item and uploads the verified **Store-draft ZIP** without publishing.
3. Human copies Item ID and **Package → View public key**.
4. Agent inserts the public key into the release manifest/source of truth.
5. Build final Store ZIP and load its unpacked contents locally.
6. Automatically compare local extension ID with dashboard Item ID.
7. Generate the native-host `allowed_origins` entry from that ID; reinstall helper and rerun the clean-profile flow.
8. Search the repository and generated artifacts for stale development IDs.

**Automation:** Public-key normalization; extension-ID derivation/comparison; stale-ID scan; native-host manifest generation; final package rebuild.

**Gate:** Dashboard Item ID = local final-build ID = helper `allowed_origins` ID. Exact final ZIP passes all package checks and functional rehearsal.

**Evidence:** Public-key fingerprint, ID-consistency report, ZIP SHA-256, helper-manifest excerpt with no secrets.

**Risks:** Confusing the Store item key with the future Verified Uploads key; rebuilding the extension but not reinstalling the helper; stale ID in reviewer instructions.

**Recovery:** Do not submit. Regenerate all ID-derived artifacts from the dashboard public key and repeat the consistency gate.

---

### Stage 5 — Exact-artifact release rehearsal

**Entry:** Permanent Store identity is aligned; listing/reviewer packet is complete.

**Ordered work:**

1. Use a fresh Chrome profile.
2. Install the unpacked contents of the final ZIP and confirm displayed ID/version.
3. Verify missing-helper guidance first.
4. Install the exact reviewer helper artifact from its public instructions.
5. Exercise: grant one tab → list/read/snapshot → approve action → deny action → revoke → browser restart/re-grant.
6. Confirm audit records, origin suspension, and no access to an ungranted tab.
7. Compare package checksum with the artifact selected for dashboard upload.
8. Complete a policy/listing parity checklist.

**Automation:** Scripted artifact/hash checks and MCP smoke flow; browser automation where reliable. Human observation remains required for Chrome permission prompts, approval UI, and visual quality.

**Gate:** Every rehearsal step passes against the exact candidate; no open blocking defect or inaccurate disclosure remains.

**Evidence:** Dated rehearsal record, command output, screenshots, artifact hash, completed parity checklist.

**Risks:** Testing a different build than the uploaded ZIP; browser-profile residue hiding setup failures.

**Recovery:** Discard the candidate, rebuild once, restart from a fresh profile, and regenerate evidence. Never patch the ZIP by hand.

---

### Stage 6 — Human batch H2: dashboard completion and submission

**Entry:** Stage 5 green; one handoff folder contains final ZIP/hash, copy, images, URLs, reviewer notes, and completed evidence checklist.

**Ordered work:**

1. Human verifies dashboard account/contact information.
2. Human pastes prepared listing and privacy text, uploads assets, and checks distribution settings.
3. Human personally reviews and accepts applicable legal/data-use certifications.
4. Human verifies reviewer instructions and helper/screencast links in a logged-out browser.
5. Human submits for review.
6. Record submitted version, checksum, timestamp, and dashboard status without recording credentials.

**Automation:** Preflight validator and handoff-folder generation. Final submission is deliberately manual.

**Gate:** Dashboard shows the expected version under review; submitted checksum and source tag/commit are recorded.

**Evidence:** Sanitized submission receipt/status and release record.

**Risks:** Dashboard copy differs from reviewed source; wrong ZIP selected; broken private screencast permissions.

**Recovery:** If still editable, withdraw/cancel and correct. Otherwise respond transparently through the review channel; do not create a second item to dodge review.

---

### Stage 7 — Review monitoring and rejection handling

**Entry:** Item is under review.

**Ordered work:**

1. Human monitors the permanent publisher mailbox; agent needs only sanitized notices.
2. Map each notice to code, package, listing, privacy, or reviewer-access evidence.
3. Reproduce any functional finding against the submitted checksum.
4. Make the narrowest honest correction under the normal approval/TDD process.
5. Increment version, regenerate all evidence, and resubmit through H2.

**Automation:** Notice-to-checklist triage template; changed-permission/data-flow detection; release-report diff.

**Gate:** Approved/public item, or a concrete documented blocker requiring product work. Rejection is not success and must not be hidden.

**Evidence:** Review outcome, public item URL/ID when approved, or rejection remediation record.

**Risks:** Guessing at vague feedback; unrelated refactors during remediation; claiming fixed without reproducing.

**Recovery:** Ask Google for clarification where supported; keep the item and history; never misdescribe behavior to obtain approval.

---

### Stage 8 — Human batch H3: Verified CRX Uploads and future releases

**Entry:** Initial item approved; key-custody owner, storage, backup, recovery, and authorized signers are documented and approved.

**Ordered work:**

1. Generate a supported RSA key pair offline under human control.
2. Store the private key in the approved password manager/HSM/offline encrypted escrow; create a separately controlled backup and recovery test.
3. Register only the public key through **Package → Opt in**.
4. Build an unchanged-version test candidate only if Google’s workflow permits non-publishing validation; otherwise validate signing locally and use the next real version.
5. Add deterministic future-release commands: build ZIP → verify → sign CRX → verify signature/public-key fingerprint → protected upload handoff.
6. Require a manual approval before credential use and preserve final publish as a human action.
7. Document lost-key escalation; Google's [update guidance](https://developer.chrome.com/docs/webstore/update/) describes support-assisted recovery for a lost Verified Uploads key.

**Automation:** Signing and verification can be scripted in a protected release environment. Key generation, custody approval, and final publish remain human-controlled.

**Gate:** A future release cannot be uploaded unless signed by the registered key; key recovery is tested; no private material appears in repository history, logs, CI artifacts, or chat.

**Evidence:** Public-key fingerprint, redacted custody/recovery attestation, local signature verification, protected-release runbook.

**Risks:** Lost/compromised key; secret exfiltration through CI logs; confusing CRX upload signing with the Store’s final distribution signing.

**Recovery:** Stop releases and follow the support-assisted recovery path documented in Google's [update guidance](https://developer.chrome.com/docs/webstore/update/); disclose incidents where applicable. Never generate a replacement silently or disable protections as a shortcut.

## Automation backlog, prioritized

### P0 — required before first submission

1. **Store package builder** with explicit file allowlist and normalized archive output.
2. **Artifact verifier** for version, manifest, key mode, permissions, host patterns, source maps, remote-code indicators, hashes, and forbidden files.
3. **Permission parity report** mapping each manifest permission to code references and dashboard justification.
4. **Store-ID consistency checker** covering manifest public key, computed/local ID, dashboard ID input, helper `allowed_origins`, docs, and reviewer packet.
5. **Listing preflight** for required copy, URLs, character limits, image dimensions, and privacy/permission parity.
6. **Release report generator** producing version, commit, hashes, commands, tests, audit status, known limitations, and residual risks.

### P1 — high-value reviewer/release efficiency

7. **Reviewer helper-kit builder** with checksums and uninstall instructions.
8. **Clean-profile rehearsal script** that guides unavoidable Chrome UI steps and automates MCP checks.
9. **Screenshot workflow** that opens deterministic demo pages, removes personal data, captures, and validates exact dimensions.
10. **Dashboard handoff generator** that produces one folder and one short human checklist for H1/H2.
11. **Link checker** for privacy, support, source, helper, and screencast URLs.

### P2 — after first approval

12. **Protected CRX signer/verifier** with fingerprint pinning and non-exporting secret handling where available.
13. **Manual-dispatch upload candidate** using protected credentials only if it reduces work without weakening review; final publish remains human.
14. **Release diff guard** highlighting permission, data-flow, executable-code, and listing-impact changes.

Automation must fail closed. A red verifier blocks the release; it must never rewrite policy declarations, weaken permissions, skip tests, or silently accept a changed artifact.

## Blocker register

| Blocker | Release impact | Resolution stage | Owner |
|---|---|---|---|
| Final Store name, policy host, and reviewer-helper fallback unconfirmed | Blocks Stage 2 implementation | Pre-Stage-2 reply | Human; agent supplies defaults |
| Permanent publisher owner/recovery/strong authentication unconfirmed | Blocks H1 dashboard work | H1 | Human only |
| Hono moderate ReDoS advisory | Precommit/release gate red | 1 | Agent after approval |
| No deterministic package/verifier | Cannot prove submitted artifact | 1 | Agent after approval |
| Version drift | Wrong/ambiguous release version | 1 | Agent after approval |
| Rename not implemented | Listing/product mismatch | 2 | Agent after approval |
| Bare `disconnected` helper state | Reviewer sees broken product | 2 | Agent after approval |
| Helper requires repo + Node; macOS-only | Reviewer access and public UX risk | 2 | Shared decision; agent implementation after approval |
| Permissions not captured as generated parity evidence | Excessive-permission/review risk | 2–3 | Agent |
| No privacy policy/public URL | Dashboard blocker | 3 | Agent draft; human certification |
| Missing compliant screenshots/promo image; icon padding unverified | Listing blocker | 3 | Agent + human visual review |
| Development ID vs Store ID | Native messaging silently fails | 4 | Human dashboard + agent automation |
| No exact-artifact rehearsal | Broken-functionality risk | 5 | Agent + human UI observation |
| Verified Uploads custody undecided | Future signed updates blocked, not first publication | 8 | Human decision |

## Evidence gate for “ready to submit”

Submission readiness requires all of the following—no proxy may replace another:

- [ ] Canonical plan and companion docs agree.
- [ ] `./precommit.sh` passes, including dependency audit.
- [ ] Final ZIP is generated, not hand-edited; checksum and contents are recorded.
- [ ] Package verifier passes and permissions match declarations.
- [ ] Dashboard Item ID, manifest key-derived ID, local ID, and native-host allowlist match.
- [ ] Missing-helper state is clear and setup URL works.
- [ ] Reviewer helper path is public, checksummed, reproducible, and honestly OS-scoped.
- [ ] Privacy policy is public and matches actual data flow, including downstream MCP-client responsibility.
- [ ] Required icon, 440×280 promo image, and at least one exact-size screenshot pass validation.
- [ ] Reviewer instructions and screencast are accessible without publisher credentials.
- [ ] Exact final artifact passes the clean-profile end-to-end rehearsal.
- [ ] Known limitations and residual risks are recorded.
- [ ] Human has reviewed legal/data-use declarations and is ready to perform submission.

## Recommended execution order

```text
0. Canonical docs
1. Audit fix + version + deterministic package/verifier
2. Name + missing-helper UX + permissions + reviewer helper kit
3. Privacy/listing/assets/reviewer packet
4. H1: account + draft upload + permanent Store ID/key
5. Rebuild ID-bound artifacts + exact-artifact rehearsal
6. H2: certify + submit
7. Review/remediate until approved
8. H3: Verified CRX Uploads + protected future-release path
```

## First smallest safe next slice

After this planning goal is accepted, create and approve one implementation change for **release foundation only**:

1. reproduce the green tests/red audit baseline;
2. resolve the Hono advisory without unrelated upgrades;
3. establish one extension version source;
4. add deterministic draft/final ZIP packaging and a strict artifact verifier;
5. run full precommit and load the generated package in a clean profile.

This slice changes no product permissions, consent behavior, privacy claims, Store account, or signing-key custody. It gives every later step a trustworthy artifact boundary.

## Official Google references

- [Chrome Web Store review process](https://developer.chrome.com/docs/webstore/review-process)
- [Publish in the Chrome Web Store](https://developer.chrome.com/docs/webstore/publish)
- [Fill out the privacy fields](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)
- [Privacy policies](https://developer.chrome.com/docs/webstore/program-policies/privacy)
- [Use of permissions](https://developer.chrome.com/docs/webstore/program-policies/permissions)
- [Supplying images](https://developer.chrome.com/docs/webstore/images)
- [Register your developer account](https://developer.chrome.com/docs/webstore/register)
- [Manifest `key` and consistent extension ID](https://developer.chrome.com/docs/extensions/reference/manifest/key)
- [Native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)
- [Verified uploads in the Chrome Web Store](https://developer.chrome.com/blog/verified-uploads-cws)
- [Update an item / protect package updates](https://developer.chrome.com/docs/webstore/update/)
- [Enterprise publishing](https://developer.chrome.com/docs/webstore/cws-enterprise)
