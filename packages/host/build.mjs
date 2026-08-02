// Build the native messaging host with esbuild: bundle workspace code
// (@ctr/shared) into dist/index.js, keep npm dependencies external (resolved
// from node_modules at runtime — the launcher runs the file in place).
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: [path.join(here, 'src/index.ts')],
  outfile: path.join(here, 'dist/index.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: true,
  external: ['@modelcontextprotocol/sdk', '@modelcontextprotocol/sdk/*', 'zod'],
  banner: { js: '#!/usr/bin/env node' },
  logLevel: 'info',
});
