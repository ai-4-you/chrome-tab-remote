# Native host — trust status

> As of 2026-08-26 · scope: local macOS development host, not a consumer or cross-platform release

## Solved and verified

| Fact | Evidence / meaning |
|---|---|
| Native host is connected in Brave. | User confirmed the panel state; host listened on `127.0.0.1:8918`. |
| The immediate disconnect cause is fixed. | The launcher had referenced a deleted Homebrew Cellar Node path. It now uses `/opt/homebrew/opt/node@22/bin/node`, an existing stable formula symlink. |
| Future Homebrew Node 22 upgrades will not retain a versioned Cellar path. | The installer resolves a Cellar Node executable to `opt/<formula>/bin/node` when that target exists. Regression coverage added. |
| Extension ↔ host pairing is restricted. | The host manifest allowlists the exact extension origin `chrome-extension://nkgapnnfibaccdmmelpnekmdebkcbebk/`. |
| Tab access is not blanket browser access. | Existing per-tab grants, origin pinning, revocation, action approval, and audit remain in force. |
| Quality gate passed. | `npm run precommit`: typecheck, lint, 244 tests, dependency audit. |

## Important limits — not solved

| Fact | Why it matters |
|---|---|
| This is a developer setup, not a consumer-safe installer. | The host launches Node code from the mutable repository checkout. |
| Windows is unsupported and unverified. | The only installer is macOS-specific; no Windows native-host registration, installer, signing, or runtime validation exists. |
| The host runs with the browser user's macOS privileges. | It can access what that user can access; it is not sandboxed. |
| The runtime still depends on Homebrew Node. | The stable `opt` symlink fixes stale-version failure, not supply-chain or runtime trust. |
| The MCP endpoint has no authentication. | Any local process can reach the localhost endpoint; this is a documented, accepted-for-now risk. |
| There is no signed/notarized self-contained host binary. | A user cannot yet verify an independently distributed helper as a project-owned release artifact. |

## Facts to challenge before calling this trustworthy for end users

1. **“Chrome Web Store review makes the helper safe.”** False. The native host is separately installed and must have its own trust and update path.
2. **“`allowed_origins` protects against local compromise.”** False. It restricts extension IDs, not code running as the same macOS user.
3. **“A localhost service needs no authentication.”** Only acceptable if every local process is trusted; that is not a general end-user assumption.
4. **“A working Node launcher is a distributable product.”** False. Reliability improved; verifiable software provenance has not.

## Required path to an end-user trust claim

```text
signed/self-contained host binary
  + signed installer + signature/hash verifier
  + macOS Developer ID, Hardened Runtime, notarization
  + stable project-owned install location per target OS
  + native-host registration and signed installer per target OS
  + authenticated/narrow local MCP transport
  + transparent version, audit, revoke, and update story
```

Chrome requires an absolute native-host executable path and an exact extension-origin allowlist. Apple’s distribution path is Developer ID signing, Hardened Runtime, and notarization.

Sources: [Chrome native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging) · [Apple notarization](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)
