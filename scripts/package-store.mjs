#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { assertStorePublicKey } from './store-package-lib.mjs';

const root = resolve(import.meta.dirname, '..');
const extension = join(root, 'packages/extension');
const dist = join(extension, 'dist');
const release = join(root, 'release');
const stage = join(release, '.store-stage');
const version = JSON.parse(readFileSync(join(extension, 'package.json'), 'utf8')).version;
const publicKey = process.env.CTR_STORE_PUBLIC_KEY;
const allowedFiles = [
  'background.js',
  'content.js',
  'icon128.png',
  'manifest.json',
  'sidepanel.css',
  'sidepanel.html',
  'sidepanel.js',
];

function fail(message) {
  throw new Error(`Store package refused: ${message}`);
}

try {
  const extensionId = assertStorePublicKey(publicKey);
  execFileSync('npm', ['run', 'build', '--workspace', '@ctr/extension'], { cwd: root, stdio: 'inherit' });
  const actual = execFileSync('find', ['.', '-type', 'f', '-maxdepth', '1', '-print'], { cwd: dist, encoding: 'utf8' })
    .trim().split('\n').filter(Boolean).map((file) => file.slice(2)).sort();
  if (JSON.stringify(actual) !== JSON.stringify([...allowedFiles].sort())) {
    fail(`dist/ does not exactly match the allowlist: ${actual.join(', ') || '(empty)'}`);
  }

  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  for (const file of allowedFiles) cpSync(join(dist, file), join(stage, file));
  const manifestPath = join(stage, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.version !== version) fail(`built manifest version ${manifest.version} differs from package version ${version}.`);
  manifest.key = publicKey.replace(/\s+/g, '');
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  for (const file of allowedFiles) utimesSync(join(stage, file), new Date(0), new Date(0));

  mkdirSync(release, { recursive: true });
  const output = join(release, `chrome-tab-remote-${version}.zip`);
  rmSync(output, { force: true });
  execFileSync('zip', ['-X', '-q', output, ...[...allowedFiles].sort()], { cwd: stage });
  execFileSync('node', [join(root, 'scripts/verify-store-package.mjs'), '--zip', output, '--public-key', publicKey], { stdio: 'inherit' });
  console.log(`Store candidate prepared: ${output} (ID ${extensionId})`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  rmSync(stage, { recursive: true, force: true });
}
