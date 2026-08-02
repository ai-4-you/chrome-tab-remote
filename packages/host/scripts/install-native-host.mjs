#!/usr/bin/env node
// Install (or uninstall) the Chrome native messaging host manifest for
// chrome-tab-remote on macOS.
//
// Usage:
//   node scripts/install-native-host.mjs <EXTENSION_ID>
//   node scripts/install-native-host.mjs --uninstall
//
// Install writes:
//   1. a launcher script  <data dir>/chrome-tab-remote-host.sh
//      (data dir = $CTR_DATA_DIR or ~/.chrome-tab-remote) that execs
//      `node <abs path to packages/host/dist/index.js>`
//   2. the manifest  ~/Library/Application Support/Google/Chrome/
//      NativeMessagingHosts/com.cgint.chrome_tab_remote.json
import { chmodSync, existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HOST_NAME = 'com.cgint.chrome_tab_remote';

const here = path.dirname(fileURLToPath(import.meta.url));
const distEntry = path.resolve(here, '../dist/index.js');
const dataDir =
  process.env.CTR_DATA_DIR && process.env.CTR_DATA_DIR.trim() !== ''
    ? process.env.CTR_DATA_DIR
    : path.join(homedir(), '.chrome-tab-remote');
const launcherPath = path.join(dataDir, 'chrome-tab-remote-host.sh');
const manifestDir = path.join(
  homedir(),
  'Library/Application Support/Google/Chrome/NativeMessagingHosts',
);
const manifestPath = path.join(manifestDir, `${HOST_NAME}.json`);

function uninstall() {
  let removed = 0;
  for (const file of [manifestPath, launcherPath]) {
    if (existsSync(file)) {
      unlinkSync(file);
      console.log(`removed ${file}`);
      removed += 1;
    } else {
      console.log(`not present: ${file}`);
    }
  }
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

  mkdirSync(dataDir, { recursive: true });
  const launcher = `#!/bin/bash\nexec "${process.execPath}" "${distEntry}" "$@"\n`;
  writeFileSync(launcherPath, launcher, 'utf8');
  chmodSync(launcherPath, 0o755);
  console.log(`wrote launcher   ${launcherPath}`);
  console.log(`  -> ${process.execPath} ${distEntry}`);

  const manifest = {
    name: HOST_NAME,
    description: 'chrome-tab-remote native messaging host (observe-only MCP bridge)',
    path: launcherPath,
    type: 'stdio',
    allowed_origins: [`chrome-extension://${extensionId}/`],
  };
  mkdirSync(manifestDir, { recursive: true });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`wrote manifest   ${manifestPath}`);
  console.log(`  allowed origin: chrome-extension://${extensionId}/`);
  console.log('install complete. Reload the extension so Chrome picks up the host.');
}

const arg = process.argv[2];
if (arg === '--uninstall') {
  uninstall();
} else if (arg && !arg.startsWith('-')) {
  install(arg);
} else {
  console.error(
    'usage: node scripts/install-native-host.mjs <EXTENSION_ID>\n' +
      '       node scripts/install-native-host.mjs --uninstall',
  );
  process.exit(1);
}
