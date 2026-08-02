#!/usr/bin/env node
// Install (or uninstall) the native messaging host manifest for
// chrome-tab-remote on macOS — per browser.
//
// Usage:
//   node scripts/install-native-host.mjs <EXTENSION_ID> [--browser chrome|brave]
//   node scripts/install-native-host.mjs --uninstall [--browser chrome|brave]
//
// Each browser gets its OWN host instance (native messaging spawns one process
// per browser), so each browser needs its own MCP port and data dir — otherwise
// the second host crashes on the occupied port in a reconnect loop.
//
// A single browser-DETECTING dispatcher launcher serves all browsers: verified
// empirically, Brave resolves the host through Chrome's NativeMessagingHosts
// directory (its compatibility fallback) even when a manifest exists in Brave's
// own directory — so per-browser launcher paths cannot be relied on. The
// dispatcher inspects its parent process name at spawn time and picks the
// browser's port/data dir itself.
//
// Install writes:
//   1. ONE dispatcher launcher  ~/.chrome-tab-remote/chrome-tab-remote-host.sh
//      that detects the invoking browser and execs the host with the matching
//      CTR_MCP_PORT and CTR_DATA_DIR
//   2. the manifest  <browser's NativeMessagingHosts>/com.cgint.chrome_tab_remote.json
//      (pointing at the shared dispatcher)
import { chmodSync, existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HOST_NAME = 'com.cgint.chrome_tab_remote';

/** Per-browser wiring: manifest location, MCP port, and data/audit directory. */
const BROWSERS = {
  chrome: {
    manifestDir: 'Library/Application Support/Google/Chrome/NativeMessagingHosts',
    port: 8917,
    dataDirName: '.chrome-tab-remote',
  },
  brave: {
    manifestDir: 'Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts',
    port: 8918,
    dataDirName: '.chrome-tab-remote-brave',
  },
};

const args = process.argv.slice(2);
const browserFlag = args.indexOf('--browser');
const browser = browserFlag >= 0 ? args[browserFlag + 1] : 'chrome';
if (!(browser in BROWSERS)) {
  console.error(`error: unknown --browser '${browser}' (known: ${Object.keys(BROWSERS).join(', ')})`);
  process.exit(1);
}
const cfg = BROWSERS[browser];

const here = path.dirname(fileURLToPath(import.meta.url));
const distEntry = path.resolve(here, '../dist/index.js');
// One shared dispatcher, always in the Chrome-default data dir.
const launcherPath = path.join(homedir(), BROWSERS.chrome.dataDirName, 'chrome-tab-remote-host.sh');
const manifestDir = path.join(homedir(), cfg.manifestDir);
const manifestPath = path.join(manifestDir, `${HOST_NAME}.json`);

function uninstall() {
  let removed = 0;
  // The dispatcher is SHARED across browsers — only remove it when no other
  // browser still has a manifest pointing at it.
  const otherManifestsExist = Object.entries(BROWSERS)
    .filter(([name]) => name !== browser)
    .some(([, other]) => existsSync(path.join(homedir(), other.manifestDir, `${HOST_NAME}.json`)));
  const files = otherManifestsExist ? [manifestPath] : [manifestPath, launcherPath];
  for (const file of files) {
    if (existsSync(file)) {
      unlinkSync(file);
      console.log(`removed ${file}`);
      removed += 1;
    } else {
      console.log(`not present: ${file}`);
    }
  }
  if (otherManifestsExist) console.log(`kept shared dispatcher ${launcherPath} (still used by another browser)`);
  console.log(removed > 0 ? 'uninstall complete.' : 'nothing to uninstall.');
}

function install(extensionId) {
  if (!/^[a-p]{32}$/.test(extensionId)) {
    console.error(
      `error: '${extensionId}' does not look like a Chrome extension id (32 chars, a-p).`,
    );
    process.exit(1);
  }
  if (!existsSync(distEntry)) {
    console.error(
      `error: built entrypoint missing: ${distEntry}\n` +
        'Run `npm run build --workspace @ctr/host` first.',
    );
    process.exit(1);
  }

  mkdirSync(path.dirname(launcherPath), { recursive: true });
  const launcher =
    '#!/bin/bash\n' +
    '# Browser-detecting dispatcher: the spawning browser is our parent process.\n' +
    'PARENT="$(ps -o comm= -p $PPID 2>/dev/null)"\n' +
    'case "$PARENT" in\n' +
    `  *[Bb]rave*)\n` +
    `    : "\${CTR_MCP_PORT:=${BROWSERS.brave.port}}"\n` +
    `    : "\${CTR_DATA_DIR:=$HOME/${BROWSERS.brave.dataDirName}}"\n` +
    '    ;;\n' +
    '  *)\n' +
    `    : "\${CTR_MCP_PORT:=${BROWSERS.chrome.port}}"\n` +
    `    : "\${CTR_DATA_DIR:=$HOME/${BROWSERS.chrome.dataDirName}}"\n` +
    '    ;;\n' +
    'esac\n' +
    'export CTR_MCP_PORT CTR_DATA_DIR\n' +
    `exec "${process.execPath}" "${distEntry}" "$@"\n`;
  writeFileSync(launcherPath, launcher, 'utf8');
  chmodSync(launcherPath, 0o755);
  console.log(`wrote dispatcher ${launcherPath}`);
  console.log(`  -> ${process.execPath} ${distEntry}`);
  console.log(
    `  chrome -> port ${BROWSERS.chrome.port} · brave -> port ${BROWSERS.brave.port} (detected at spawn)`,
  );

  const manifest = {
    name: HOST_NAME,
    description: `chrome-tab-remote native messaging host for ${browser} (MCP bridge: observe + user-approved actions)`,
    path: launcherPath,
    type: 'stdio',
    allowed_origins: [`chrome-extension://${extensionId}/`],
  };
  mkdirSync(manifestDir, { recursive: true });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`wrote manifest   ${manifestPath}`);
  console.log(`  allowed origin: chrome-extension://${extensionId}/`);
  console.log(
    `install complete. Reload the extension in ${browser}; MCP endpoint: http://127.0.0.1:${cfg.port}/mcp`,
  );
}

const positional = args.filter((a, i) => !a.startsWith('-') && args[i - 1] !== '--browser');
if (args.includes('--uninstall')) {
  uninstall();
} else if (positional[0]) {
  install(positional[0]);
} else {
  console.error(
    'usage: node scripts/install-native-host.mjs <EXTENSION_ID> [--browser chrome|brave]\n' +
      '       node scripts/install-native-host.mjs --uninstall [--browser chrome|brave]',
  );
  process.exit(1);
}
