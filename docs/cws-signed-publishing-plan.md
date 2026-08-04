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
| Publisher identity | No permanent owner/recovery/strong-auth evidence, required publisher name, or verified contact email is recorded | Complete in H1 |
| Store-facing name | Existing 2026-08-02 analysis selected **AI Tab Grant**; explicit current-user confirmation is not recorded, and code still says Chrome Tab Remote | Confirm in the pre-Stage-2 decision reply |
| Package | Build exists; no deterministic bootstrap/final ZIP commands, version transition, candidate lock, or artifact verifier | **Blocking** |
| Version | Manifest is `0.1.0`; extension package is `0.0.0` | **Blocking** |
| Extension identity | Manifest pins a development public key; the native host allowlists the resulting ID | Draft Store identity required |
| Reviewer experience | Panel says only `disconnected`; helper requires this repo, Node, a build, and a macOS-only installer | **Highest rejection risk** |
| Privacy | No public policy URL or finalized dashboard disclosures | **Blocking** |
| Listing assets | 128×128 icon exists; its artwork padding is unverified. Existing screenshot is 1322×1630, not an accepted Store screenshot size. Required 440×280 promo image is absent | **Blocking** |
| Publication control | Deferred publishing is selected by this plan but no H2a submission/H2b manual-publish evidence exists | Post-review release gate |
| Signing | Verified CRX Uploads selected for future updates; custody/recovery and informed irreversible opt-in remain undecided | Post-first-publication gate |
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
7. **No reviewer tricks.** A screencast and detailed notes explain setup; they do not replace an accurate **Native helper unavailable** state and a reproducible helper setup/troubleshooting path.
8. **Bootstrap is not submission.** The first ZIP exists only to create the dashboard item and retrieve its public key. Adding that key changes the package, so the final candidate uses a strictly higher version, is rehearsed, and is explicitly uploaded with **Upload New Package** before review.
9. **Publication is deliberately deferred.** H2a disables automatic publication. Approval creates a staged/ready-to-publish state; H2b manually publishes after a final check and before the dashboard expiry (currently up to 30 days per Google's [update guidance](https://developer.chrome.com/docs/webstore/update/)).
10. **Verified Uploads opt-in is human-only.** Treat it as irreversible, require the human to read/capture the live dashboard warning, and never automate the opt-in click. Public docs verify the future-signing requirement but do not clearly document a disable path.

## Minimal-human operating model

Human work is concentrated into one short pre-Stage-2 decision reply and four guided operational touchpoints. H2 is split because Google review separates submission from the deliberately deferred final publication. Everything else is prepared and verified beforehand.

```text
Agent/repo work → H1: account + identity-bootstrap upload
                → Agent: final higher-version build + rehearsal
                → H2a: upload exact final ZIP + certify + submit deferred
                → Google review
                → H2b: manually publish approved staged item
                → H3: informed Verified Uploads opt-in
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
3. completes the Account page per Google's [account setup guidance](https://developer.chrome.com/docs/webstore/set-up-account): required publisher name, required contact-email verification through the emailed link, staged/published notification preferences, and the physical-address applicability check;
4. creates the draft item and uploads the prepared **identity-bootstrap ZIP**;
5. copies the dashboard Item ID and **Package → View public key** into a local handoff file or directly into the guided terminal prompt.

The agent does not handle credentials, payment details, account recovery, or acceptance of terms.

### Human batch H2a — final artifact, certification, and deferred submission

Target: 20–30 focused minutes after every dashboard answer, asset, and exact final ZIP has been prebuilt and rehearsed.

The human:

1. uses **Package → Upload New Package** to upload the single rehearsed final ZIP from the handoff folder;
2. verifies the dashboard shows its strictly higher final version;
3. reviews and truthfully confirms the privacy/data-use declarations;
4. uploads prebuilt listing assets and pastes reviewed copy;
5. verifies public distribution visibility, support contact, reviewer instructions, and links;
6. clicks **Submit for Review** and explicitly unchecks automatic publication to select deferred publishing.

The agent may guide screen-by-screen but does not upload under the user's credentials, click legal certifications, choose publication timing, or submit.

### Human batch H2b — manual publication after approval

Target: 5–10 focused minutes after Google marks the item approved and ready to publish.

The human verifies the staged version/listing once more and manually publishes it before the dashboard's staged-submission expiry. Google's [update guidance](https://developer.chrome.com/docs/webstore/update/) gives up to 30 days; the live dashboard expiry is authoritative and must be recorded.

### Human batch H3 — signed future uploads

Target: 15–20 focused minutes only after H2b has manually published the initial item and key-custody preparation is complete.

The human:

1. approves the signing-key custody location and authorized operators;
2. performs or observes offline key generation;
3. reads the live Package-tab warning, confirms the opt-in is to be treated as irreversible, and records an informed acknowledgment; public documentation verifies the future-signing requirement, while the live dashboard warning is the authority for disable/irreversibility wording;
4. personally clicks **Package → Opt in** and registers only the public key;
5. stores and tests the documented recovery material.

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
| Create Store account, pay fee, set publisher name, and verify contact email | Human | None | Never automated; emailed verification link stays human-controlled |
| Accept developer agreement or limited-use certification | Human | None | Never automated |
| Upload identity-bootstrap ZIP and retrieve Store public key/ID | Human, agent-guided | Low | Dashboard credentials remain human-controlled |
| Upload the exact rehearsed final ZIP with a higher version | Human, agent-guided | Low | Never substitute another artifact; credentials remain human-controlled |
| Insert public Store key and verify ID consistency | Agent/script | Full | Public material; runtime/release edit still needs implementation approval |
| Build reviewer helper kit | Agent/script | High | Code-signing/notarization credentials remain human-controlled |
| Record reviewer screencast | Human + agent script/checklist | Medium | No secrets or unrelated browser data in recording |
| Choose deferred publishing and submit for review | Human | None | Never automated; publication timing is an informed choice |
| Manually publish the approved staged item | Human | None | Never automated; verify version/listing and live expiry first |
| Triage rejection notice | Agent | High | Human supplies notice; behavior/policy changes require approval |
| Generate Verified Uploads key pair | Human-controlled offline procedure | Deliberately limited | Private-key custody decision cannot be delegated |
| Opt into Verified CRX Uploads | Human | None | Treat as irreversible; read live dashboard warning; never automate |
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
2. Add a tested **Native helper unavailable** state that explains possible causes (not installed, crashed, or misconfigured), the consequence, public setup/troubleshooting links, and retry/status information. State “not installed” only when diagnostics establish it.
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
5. Prepare reviewer notes with helper download, checksum, supported OS, exact install/test steps, expected helper-unavailable state, source link, and screencast link.
6. Record one continuous clean-profile screencast without private tabs, credentials, tokens, file paths, or signing material.

**Automation:** Generate copy from a checked-in source-of-truth template; validate character counts, URLs, image dimensions, required fields, and permission parity; generate reviewer checklist and checksums.

**Gate:** Public URLs return successfully; every manifest permission has a matching justification; every disclosed data flow matches code and documentation; all images pass dimensional checks; reviewer packet reproduces the flow.

**Evidence:** Link-check output, data-flow review, image validator output, permission matrix, human sign-off on legal statements.

**Risks:** Overclaiming “no cloud”; under-disclosing page content/URLs; listing copy diverges from code; screenshots reveal personal data.

**Recovery:** Stop submission, correct the source-of-truth text/assets, regenerate dashboard material, and repeat privacy parity review.

---

### Stage 4 — Human batch H1: account, identity bootstrap, permanent Store ID

**Entry:** The identity-bootstrap ZIP passes Stage 1 verification at version `V_bootstrap`; H1 handoff contains only that ZIP, checksum, account checklist, and public-key capture instructions.

**Ordered work:**

1. Human registers the permanent publisher account, pays the fee, sets the required publisher name, verifies the required contact email through Google's emailed link, configures notifications, and records whether a physical address applies.
2. Human creates a draft item and uploads the verified **identity-bootstrap ZIP** without submitting it for review.
3. Human copies Item ID and **Package → View public key**.
4. Agent inserts the public Store key into the release manifest/source of truth.
5. Because the packaged manifest changed, choose `V_final > V_bootstrap`; Google's [update guidance](https://developer.chrome.com/docs/webstore/update/) requires each uploaded replacement version to be larger.
6. Build the final Store ZIP at `V_final` and load its unpacked contents locally.
7. Automatically compare the local extension ID with the dashboard Item ID.
8. Generate the native-host `allowed_origins` entry from that ID, reinstall the helper, and search source/generated artifacts for stale development IDs.

**Automation:** Public-key normalization; strict version comparison; extension-ID derivation/comparison; stale-ID scan; native-host manifest generation; final package rebuild.

**Gate:** Required account fields/contact verification are complete. Dashboard Item ID = local final-build ID = helper `allowed_origins` ID. The not-yet-uploaded final ZIP at `V_final` passes package checks.

**Evidence:** Sanitized account-setup checklist, public-key fingerprint, `V_bootstrap → V_final` record, ID-consistency report, final ZIP SHA-256, and helper-manifest excerpt with no secrets.

**Risks:** Mistaking the bootstrap ZIP for the release candidate; reusing `V_bootstrap`; confusing the Store item key with the future Verified Uploads key; stale native-host ID.

**Recovery:** Do not continue to rehearsal. Correct account verification or regenerate all ID/version-derived artifacts, choose a version greater than every package already uploaded to the item, and repeat the gate.

---

### Stage 5 — Lock and rehearse the exact final artifact

**Entry:** Permanent Store identity is aligned; final ZIP `V_final` and listing/reviewer packet are complete.

**Ordered work:**

1. Place exactly one candidate ZIP in the generated H2 handoff folder; record its filename, absolute handoff path, version, SHA-256, source commit, and build command in the release report.
2. Use a fresh Chrome profile and install the unpacked contents of that ZIP; confirm displayed Store ID and `V_final`.
3. Verify helper-unavailable guidance first, including absence, crash, and misconfiguration wording.
4. Install the exact reviewer helper artifact from its public instructions.
5. Exercise: grant one tab → list/read/snapshot → approve action → deny action → revoke → browser restart/re-grant.
6. Confirm audit records, origin suspension, and no access to an ungranted tab.
7. Complete package, permission, privacy, listing, and reviewer-instruction parity checks.
8. Mark the candidate immutable: any packaged-file change invalidates the rehearsal and requires a strictly higher version.

**Automation:** Handoff-folder generation; single-ZIP assertion; artifact/hash/version/source checks; MCP smoke flow; browser automation where reliable. Human observation remains required for Chrome permission prompts, approval UI, and visual quality.

**Gate:** Every rehearsal step passes against the single locked candidate. Its release report is complete, and no open blocking defect or inaccurate disclosure remains.

**Evidence:** Dated rehearsal record, command output, screenshots, candidate-lock release report, artifact hash, and completed parity checklist.

**Risks:** Rehearsing one ZIP but selecting another; browser-profile residue hiding setup failures; changing packaged files after the rehearsal.

**Recovery:** Discard/unlock the candidate. If packaged files change, choose a version greater than every package already uploaded, rebuild once, restart from a fresh profile, and regenerate all evidence. Never patch the ZIP by hand.

---

### Stage 6 — Human batch H2a: upload final artifact and submit deferred

**Entry:** Stage 5 is green; one handoff folder contains exactly one locked final ZIP plus its release report/hash, copy, images, URLs, reviewer notes, and completed evidence checklist.

**Ordered work:**

1. Human confirms required Account-page fields and verified contact email remain complete.
2. Human opens **Package → Upload New Package** and selects the only candidate ZIP in the handoff folder.
3. Human and agent-guided checklist verify the dashboard now shows `V_final`; record selected filename/path, local SHA-256, upload timestamp, and dashboard version. The bootstrap package is no longer the package to be reviewed.
4. Human pastes prepared listing/privacy text, uploads assets, and verifies public distribution, support contact, reviewer instructions, and helper/screencast links.
5. Human personally reviews and accepts applicable legal/data-use certifications.
6. Human clicks **Submit for Review** and explicitly unchecks automatic publication, selecting deferred publishing.
7. Record the under-review status, expected staged-publication mode, `V_final`, source commit, and local checksum without recording credentials.

**Automation:** Preflight validator; handoff-folder generation; one-candidate assertion; immediate pre-upload hash/version check; release-record generation. Upload, certifications, publication-mode choice, and submission remain manual.

**Gate:** Dashboard shows `V_final` under review, deferred publishing is recorded, and the selected artifact evidence matches the locked Stage 5 candidate. No package mutation occurred after rehearsal.

**Evidence:** Candidate-lock report; local SHA-256; sanitized Package-tab/version evidence; selected-file attestation; deferred-publishing selection; submission receipt/status; source commit.

**Risks:** Selecting the bootstrap/wrong ZIP; uploading the final ZIP but rehearsing another; forgetting deferred publishing; dashboard copy differing from reviewed source; broken reviewer links.

**Recovery:** Cancel review. If only dashboard metadata changes, correct and resubmit as Google permits. If any packaged file changes, increment above the dashboard's highest uploaded version, rebuild, repeat Stage 5, upload the new locked candidate, and resubmit. Never create a second item to dodge review.

---

### Stage 7 — Review, staged approval, and human publication

**Entry:** Exact locked artifact `V_final` is under review with deferred publishing selected.

**Ordered work:**

1. Human monitors the permanent publisher mailbox and dashboard; agent receives only sanitized notices/status.
2. If rejected, map each notice to package, code, listing, privacy, or reviewer-access evidence; reproduce findings against the submitted candidate.
3. Make the narrowest honest correction under normal approval/TDD. Packaged changes require a version greater than every prior dashboard upload, then Stage 5 and H2a repeat.
4. If approved, verify the dashboard state is **ready to publish/staged**, not public. Record the live expiry; Google's [update guidance](https://developer.chrome.com/docs/webstore/update/) permits up to 30 days, but the dashboard date is authoritative.
5. H2b: human rechecks staged version, listing, privacy/support links, and known limitations, then manually clicks Publish before expiry.
6. Verify the public Store URL resolves and shows the intended version/publisher/listing.

**Automation:** Status/expiry reminders; notice-to-checklist triage; changed-permission/data-flow detection; release-report diff; post-publication URL/version check. Final Publish remains manual.

**Gate:** Either (a) the human-published item is publicly reachable at the intended version with publication evidence, or (b) a concrete rejection/staged-publication blocker is documented. Approval/staged status alone is not publication.

**Evidence:** Separate review outcome and manual-publication records; staged expiry; public item URL/ID/version/publisher check; or rejection remediation record.

**Risks:** Accidentally enabling auto-publish; treating approved/staged as public; missing the staged expiry; publishing the wrong version/listing; guessing at vague rejection feedback.

**Recovery:** Before publication, use Cancel publish to return the staged item to draft when correction is needed, then repeat the required gates/review. If the staged submission expires it reverts to draft and must be resubmitted. Never misdescribe behavior or create another item to evade review.

---

### Stage 8 — Human batch H3: informed Verified CRX Uploads opt-in and future releases

**Entry:** Initial item is public; key-custody owner, storage, backup, recovery, and authorized signers are documented and approved.

**Ordered work:**

1. Generate a supported 2048-bit RSA key pair offline under human control.
2. Store the private key in the approved password manager/HSM/offline encrypted escrow; create a separately controlled backup and recovery test.
3. Human reads the live Package-tab opt-in warning. Safety rule: treat opt-in as irreversible and never automate it. Google's [update guidance](https://developer.chrome.com/docs/webstore/update/) establishes that every future package update must be signed after opt-in but does not clearly document a disable path; capture the dashboard's exact warning and pause if it differs from this assumption.
4. Human records informed acknowledgment, personally clicks **Package → Opt in**, and registers only the public key.
5. Validate CRX signing and fingerprint checks locally without uploading a same-version test package. The next real package update must use a strictly larger version.
6. Add deterministic future-release commands: build → verify → sign CRX → verify signature/public-key fingerprint → protected upload handoff.
7. Require manual approval before credential use; future submission/publication timing retains the H2a/H2b human gates.
8. Document and test the lost-key escalation path before opt-in. The public update page fetched for this plan does not specify recovery timing; capture the current dashboard/support instructions rather than inventing a guarantee.

**Automation:** Local signing and verification can be scripted in a protected release environment. Key generation/custody approval, opt-in acknowledgment/click, credential use approval, and final publication remain human-controlled.

**Gate:** Informed irreversible-choice acknowledgment is recorded; registered public-key fingerprint matches custody records; recovery is tested; a future release cannot be uploaded unless signed; no private material appears in repository history, logs, CI artifacts, or chat.

**Evidence:** Captured/redacted dashboard-warning text, informed opt-in attestation, public-key fingerprint, redacted custody/recovery attestation, local signature verification, protected-release runbook.

**Risks:** Irreversible opt-in without tested custody; lost/compromised key; secret exfiltration through CI logs; same-version upload attempts; confusing upload signing with Google's final Store signing.

**Recovery:** Before opt-in, stop if custody/recovery, escalation instructions, or dashboard wording are unclear. After opt-in, stop releases and use the pre-verified dashboard/support escalation path; disclose incidents where applicable. Never generate a replacement silently or seek to bypass signing protections.

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
10. **Dashboard handoff generator** that produces single-candidate folders and short checklists for H1, H2a, and H2b.
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
| Publisher owner/recovery, required publisher name, verified contact email, and strong authentication incomplete | Blocks H1 dashboard work | H1 | Human only |
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
| No exact-artifact rehearsal and single-candidate lock | Wrong artifact may be uploaded | 5 | Agent + human UI observation |
| Final rehearsed ZIP not uploaded over bootstrap package | Bootstrap could be reviewed instead of release candidate | H2a | Human, agent-guided |
| Deferred-publish/manual-publication gates not yet exercised | Approval could auto-publish or remain staged/expire | H2a/H2b | Human only |
| Verified Uploads custody and informed irreversible opt-in undecided | Future signed updates blocked, not first publication | 8 | Human only |

## Evidence gate for “ready to submit”

Submission readiness requires all of the following—no proxy may replace another:

- [ ] Canonical plan and companion docs agree.
- [ ] `./precommit.sh` passes, including dependency audit.
- [ ] Final ZIP is generated, not hand-edited; checksum and contents are recorded.
- [ ] Package verifier passes and permissions match declarations.
- [ ] Required Account-page publisher name/contact email are complete and the emailed verification link has been used.
- [ ] Dashboard Item ID, manifest key-derived ID, local ID, and native-host allowlist match.
- [ ] Identity-bootstrap and strictly higher final versions are recorded.
- [ ] **Native helper unavailable** state is accurate, covers absence/crash/misconfiguration, and setup/troubleshooting URLs work.
- [ ] Reviewer helper path is public, checksummed, reproducible, and honestly OS-scoped.
- [ ] Privacy policy is public and matches actual data flow, including downstream MCP-client responsibility.
- [ ] Required icon, 440×280 promo image, and at least one exact-size screenshot pass validation.
- [ ] Reviewer instructions and screencast are accessible without publisher credentials.
- [ ] Exactly one locked final ZIP passes the clean-profile end-to-end rehearsal; its filename/path/version/hash/source commit are recorded.
- [ ] That exact ZIP has been uploaded with **Upload New Package** and the dashboard shows its final version rather than the bootstrap version.
- [ ] Known limitations and residual risks are recorded.
- [ ] Human has reviewed legal/data-use declarations, selected deferred publishing, and is ready to perform submission.

## Publication completion gate

Approval is not publication. Completion of the initial Store release requires: deferred/ready-to-publish status recorded; H2b human version/listing check; manual Publish before the live expiry; public Store URL resolving with the intended item ID/version/publisher; and separate review versus publication timestamps.

## Recommended execution order

```text
0. Canonical docs
1. Audit fix + version + deterministic package/verifier
2. Name + helper-unavailable UX + permissions + reviewer helper kit
3. Privacy/listing/assets/reviewer packet
4. H1: account/profile verification + identity-bootstrap upload + Store ID/key
5. Build strictly higher final version + lock/rehearse exact artifact
6. H2a: upload exact final ZIP + certify + submit with deferred publishing
7. Review/remediate; on approval H2b manually publishes before expiry
8. H3: informed Verified Uploads opt-in + protected future-release path
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
- [Set up your developer account](https://developer.chrome.com/docs/webstore/set-up-account)
- [Manifest `key` and consistent extension ID](https://developer.chrome.com/docs/extensions/reference/manifest/key)
- [Native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)
- [Verified uploads in the Chrome Web Store](https://developer.chrome.com/blog/verified-uploads-cws)
- [Update an item / protect package updates](https://developer.chrome.com/docs/webstore/update/)
- [Enterprise publishing](https://developer.chrome.com/docs/webstore/cws-enterprise)
