# macOS native-host delivery — issue split

> As of 2026-08-26 · planning only · Windows deliberately out of scope for this track

## Goal

A macOS user can install, verify, update, and remove the native host **without a repository checkout, Homebrew, or manual manifest editing**. The release must be understandable and trustworthy.

## First decision: what does “unattended from us” mean?

This is not one feature. Choose the intended authority model before implementation:

| Model | Meaning | Status |
|---|---|---|
| User-initiated install | User downloads and explicitly runs our signed installer; subsequent setup is noninteractive. | Candidate for public macOS v1 |
| Managed deployment | An organization deploys/updates through MDM. | Separate enterprise track |
| Automatic updates | An already-installed helper updates itself. | Later; requires an update trust/rollback design |

Do not promise silent first-time installation without explicit user or organization authority.

## Evidence-backed macOS baseline — proposed, not approved

Use a **user-authorized, system-wide signed `.pkg`** for the first macOS release. It is unattended after the user authorizes installation, not a silent first-time install.

```text
signed/notarized .pkg
  ├─ /Library/Application Support/Chrome Tab Remote/host/<immutable host artifact>
  └─ /Library/Google/Chrome/NativeMessagingHosts/com.cgint.chrome_tab_remote.json
        └─ absolute path to the installed host artifact
```

Why this baseline:

- Chrome documents the system-wide manifest location and requires an absolute macOS host path.
- The fixed `/Library` paths avoid fragile per-user home-directory discovery in installer scripts.
- The initial administrator authorization is explicit, and the same package model can later support managed deployment.
- The package contains the host artifact itself: no repository, Homebrew, shell launcher, or post-install host start.

The installer must be signed with **Developer ID Installer**; executable code with **Developer ID Application** and Hardened Runtime; the final `.pkg` notarized with `notarytool`, stapled, and verified. The exact installed extension ID is release input: the manifest must contain that ID in its non-wildcard `allowed_origins`.

**Unverified until a release spike:** supported macOS versions/architectures; precise file permissions and multi-user audit-data location; artifact technology; clean-machine install/update/uninstall behavior; browser reload/reconnect UX.

A no-admin per-user package remains an alternative, but must first prove correct absolute-manifest generation, upgrade/uninstall behavior, and installer user-context handling. Do not select it from documentation alone.

## Dependency-ordered issues

| # | Issue | What it must establish | Acceptance gate |
|---:|---|---|---|
| M0 | Distribution contract | Supported macOS versions/architectures; install authority; per-user vs system-wide location; update, rollback, uninstall ownership. | Approved lifecycle and threat model. |
| M1 | Immutable host artifact | A versioned, self-contained host; no checkout or Homebrew Node at runtime; current native-messaging protocol retained. Compare artifact options before selection: Node SEA is not a default because Node currently documents macOS SEA CI only for arm64, not x64. | Clean supported Mac runs host and extension with no repo/Homebrew on every supported architecture; compatibility tests pass; version/provenance are inspectable. |
| M2 | Local security boundary | Exact extension-origin allowlist remains; localhost MCP authentication, secret lifecycle, loopback binding, and log redaction are defined. | Negative tests reject an unauthorized extension origin and unauthenticated local client. |
| M3 | Idempotent macOS installer | Deterministic destination; native-host manifest registration; noninteractive repeated install; atomic upgrade/recovery; uninstall; safe permissions. | Fresh install, repeat install, upgrade, interrupted-install recovery, and uninstall work on clean macOS accounts. The manifest never points at a checkout. |
| M4 | Authentic release and updates | Developer ID Application signing for code; Developer ID Installer signing for the `.pkg`; Hardened Runtime, notarization, integrity metadata, release provenance, update/rollback policy. | A clean Mac verifies the downloaded release without bypass instructions; package signature/notarization checks pass; tampering is rejected. |
| M5 | User and Store integration | Clear installer instructions, helper-unavailable state, support/removal instructions, privacy disclosures, and reviewer setup. | A reviewer/user can complete setup without developer prerequisites; documents match runtime behavior. |

```text
M0 distribution contract
 ├─ M1 immutable host artifact ─┐
 └─ M2 local security boundary ─┼─ M3 installer lifecycle ─ M4 signed release ─ M5 user/Store integration
                                └────────────────────────────────────────────────────────────────────
```

## Facts retained from the current setup

- The development host is now reliable across Homebrew Node 22 upgrades: its launcher uses Homebrew’s stable `opt` symlink, not a versioned Cellar path.
- It remains **development-only**: it starts Node code from the repository and exposes an unauthenticated localhost MCP endpoint.
- Exact extension-origin allowlisting, per-tab grants, action approval, revocation, and audit are existing controls to preserve—not substitutes for artifact and transport trust.

## Responsibility boundary

| Area | Human / user attention | Agent can do autonomously after implementation approval |
|---|---|---|
| Product authority | Choose user-authorized system install vs MDM; supported macOS versions and arm64/x64; approve automatic-update policy. | Turn the chosen contract into requirements, tests, installer design, and documentation. |
| Host artifact | Approve the artifact choice after evidence; do not choose by familiarity. | Build and compare candidate artifacts; preserve protocol behavior; measure size; run available clean-machine tests. |
| Apple trust identity | Create/control the Apple Developer account, certificates, notarization credentials, recovery, and any legal agreements. | Prepare signing/notarization commands, integrity verifier, release checklist, and redacted CI design. Never receive or store private keys/passwords. |
| Installer lifecycle | Approve install location, administrator prompt, and uninstall/data-retention behavior. | Implement idempotent install/upgrade/uninstall, manifest generation, permission checks, recovery tests, and user instructions. |
| Local MCP security | Approve the authentication and recovery UX. | Design and implement the selected mechanism; add authorization, rotation/removal, negative, and regression tests. |
| Evidence | Provide or authorize access to clean supported Macs—especially Intel if not otherwise available—and personally inspect the signed-install experience. | Run automated tests, collect non-sensitive evidence, verify signatures/notarization, and report gaps honestly. |
| Release | Approve release content, privacy/support claims, and publication; perform credential- or legal-bound actions. | Build deterministic artifacts, hashes, SBOM/release notes, reviewer/user instructions, and pre-release verification. |

**Human-only:** account ownership, credential custody, legal acceptance, installation authority, release/publication approval, and final trust claims.

**Agent-owned once authorized:** implementation, test automation, packaging automation that does not access private credentials, documentation, and evidence collection.

**Joint gates:** artifact choice, clean-machine acceptance, signing/notarization rehearsal, and release approval.

## Agent to-do plan — no runtime implementation before its gate

| ID | Agent task | Prerequisite | Deliverable | Evidence of done |
|---|---|---|---|---|
| A1 | Freeze the current native-message protocol as compatibility tests. | None. | Tests for host startup, framing, `hostInfo`, grant sync, tool calls, shutdown, and error handling. | Production artifact passes the same tests as the development host. |
| A2 | Produce an artifact decision record. | None. | Evidence table comparing Node SEA, bundled runtime, and any viable alternative: arm64/x64 support, ESM/module loading, signing, size, reproducibility, update and rollback behavior. | No option is selected without clean-machine arm64 and x64 proof. |
| A3 | Build the selected artifact. | Human approves the A2 decision. | Versioned immutable host artifact with `--version`/provenance output; no checkout/Homebrew dependency. | On a clean supported Mac, host starts and passes A1 with the repository and Node absent. |
| A4 | Design and implement local MCP authentication. | Human approves the authentication/recovery UX. | Loopback-only authentication, credential creation/storage/rotation/removal, redacted logging, and recovery instructions. | Unauthenticated localhost calls and invalid credentials are rejected; authorized calls retain current behavior. |
| A5 | Generate the system-wide Chrome manifest from release inputs. | Final Chrome extension ID is supplied by the human-controlled Store flow; A3 artifact path is fixed. | Valid manifest at the documented system path with exact `allowed_origins` and absolute artifact path. | Schema/path/extension-ID checks fail closed on missing or mismatched inputs. |
| A6 | Build deterministic `.pkg` packaging. | A3, A5, and approved install/data-retention policy. | Payload layout, install/upgrade/uninstall scripts only where necessary, stable permissions, package metadata, and versioned build command. | Fresh install, repeat install, upgrade, interrupted-install recovery, and uninstall pass; no manifest points into a checkout. |
| A7 | Build a public verifier. | A6. | One command that reports package identity, artifact version, manifest target/origin, code signature, notarization ticket, and hashes. | It succeeds for the release package and fails for a controlled tampered copy. |
| A8 | Automate release preparation. | A6/A7; human configures protected signing/notarization access. | Reproducible build, SBOM/hashes, sign/notarize/staple/validate steps, and release evidence bundle. | A rehearsal yields one traceable package; no private credentials enter source, logs, or artifacts. |
| A9 | Create user/reviewer materials. | A6/A7. | Install, verify, reconnect, update, remove, helper-unavailable, privacy, and support instructions. | A clean-machine tester completes the documented path without developer prerequisites. |
| A10 | Run the acceptance matrix and record results. | Human provides or authorizes clean arm64 and Intel macOS environments. | Results for supported macOS/browser versions: install, native connection, auth rejection/acceptance, upgrade, uninstall, tamper rejection. | Every claimed platform has passing runtime evidence; absent hardware remains explicitly unsupported. |

### Execution order

```text
A1 + A2 → [human artifact decision] → A3
A3 + [human auth UX decision] → A4
A3 + [final Store ID] → A5 → A6 → A7 → A8 + A9 → A10
```

### Agent stop-and-handoff points

- **After A2:** present evidence; do not choose the host artifact unilaterally.
- **Before A4:** present the authentication/recovery UX; do not silently create a credential model.
- **Before A5:** obtain the final Store extension ID; do not embed the current development ID in a public package.
- **Before A8:** the human creates/custodies signing and notarization credentials; the agent never receives them.
- **Before release:** the human reviews the verified package, disclosures, and publication decision.

## Stop conditions

Do not start production installer implementation while any of these remain undecided:

1. install authority model;
2. localhost MCP authentication design;
3. immutable-host artifact strategy.

Related: [`native-host-trust-status.md`](./native-host-trust-status.md) · [Store publishing plan](./cws-signed-publishing-plan.md)
