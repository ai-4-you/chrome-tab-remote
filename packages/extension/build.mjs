// esbuild bundling for the MV3 extension (no vite, by design — small reviewable surface).
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, 'dist');
mkdirSync(dist, { recursive: true });

const common = {
  bundle: true,
  target: 'chrome120',
  sourcemap: false,
  logLevel: 'info',
};

// Background service worker: ESM (manifest declares "type": "module").
await build({
  ...common,
  entryPoints: [join(root, 'src/background/index.ts')],
  outfile: join(dist, 'background.js'),
  format: 'esm',
});

// Content script: IIFE — injected programmatically via chrome.scripting.executeScript.
await build({
  ...common,
  entryPoints: [join(root, 'src/content/index.ts')],
  outfile: join(dist, 'content.js'),
  format: 'iife',
});

// Side panel script: ESM, loaded from sidepanel.html.
await build({
  ...common,
  entryPoints: [join(root, 'src/sidepanel/sidepanel.ts')],
  outfile: join(dist, 'sidepanel.js'),
  format: 'esm',
});

// Static files. The extension package version is the authoritative release
// version; inject it into the built manifest so normal `npm run build` remains
// the development workflow while Store artifacts cannot drift.
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const packageVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
manifest.version = packageVersion;
writeFileSync(join(dist, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

const statics = [
  ['icon128.png', 'icon128.png'],
  ['src/sidepanel/sidepanel.html', 'sidepanel.html'],
  ['src/sidepanel/sidepanel.css', 'sidepanel.css'],
];
for (const [from, to] of statics) {
  copyFileSync(join(root, from), join(dist, to));
}
