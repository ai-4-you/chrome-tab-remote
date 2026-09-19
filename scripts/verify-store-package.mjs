#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import {
  assertStorePublicKey,
  remoteExecutableLoaderReason,
  STORE_EXTENSION_ID,
  STORE_ORIGIN,
} from './store-package-lib.mjs';

const ALLOWLIST = ['background.js', 'content.js', 'icon128.png', 'manifest.json', 'sidepanel.css', 'sidepanel.html', 'sidepanel.js'];
function argument(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function fail(message) { throw new Error(`Store package verification failed: ${message}`); }

try {
  const zip = argument('--zip');
  const publicKey = argument('--public-key');
  const nativeHostManifest = argument('--native-host-manifest');
  if (!zip || !publicKey || !nativeHostManifest) fail('usage: --zip PATH --public-key BASE64_DER --native-host-manifest PATH');
  if (!existsSync(zip)) fail(`ZIP does not exist: ${zip}`);
  if (!existsSync(nativeHostManifest)) fail(`production native-host manifest does not exist: ${nativeHostManifest}`);
  const extensionId = assertStorePublicKey(publicKey);
  const files = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).trim().split('\n').filter(Boolean).sort();
  if (JSON.stringify(files) !== JSON.stringify(ALLOWLIST)) fail(`ZIP contents differ from strict allowlist: ${files.join(', ') || '(empty)'}`);
  if (files.some((file) => file.endsWith('.map'))) fail('source maps are forbidden.');
  for (const file of files.filter((name) => name.endsWith('.js') || name.endsWith('.html'))) {
    const content = execFileSync('unzip', ['-p', zip, file], { encoding: 'utf8' });
    const reason = remoteExecutableLoaderReason(content, file);
    if (reason) fail(`${reason} in ${file}.`);
  }
  const manifest = JSON.parse(execFileSync('unzip', ['-p', zip, 'manifest.json'], { encoding: 'utf8' }));
  if (!/^\d+(\.\d+){1,3}$/.test(manifest.version)) fail(`invalid manifest version: ${manifest.version}`);
  const sourceVersion = JSON.parse(readFileSync(new URL('../packages/extension/package.json', import.meta.url), 'utf8')).version;
  if (manifest.version !== sourceVersion) fail(`manifest version ${manifest.version} differs from authoritative package version ${sourceVersion}.`);
  if (manifest.key !== publicKey.replace(/\s+/g, '')) fail('manifest key does not equal the supplied public key.');
  if (manifest.manifest_version !== 3) fail(`unexpected manifest version: ${manifest.manifest_version}`);
  if (manifest.name !== 'Chrome Tab Remote') fail(`unexpected manifest name: ${manifest.name}`);
  if (manifest.background?.service_worker !== 'background.js') fail('background service worker must be local background.js.');
  if (manifest.side_panel?.default_path !== 'sidepanel.html') fail('side panel must be local sidepanel.html.');
  if (!Object.values(manifest.icons ?? {}).every((icon) => typeof icon === 'string' && ALLOWLIST.includes(icon))) {
    fail('manifest icons must be files in the ZIP allowlist.');
  }
  const csp = manifest.content_security_policy;
  if (typeof csp === 'string' && (/(?:https?:)?\/\//iu.test(csp) || /'unsafe-eval'/iu.test(csp))) {
    fail('manifest content security policy permits remote code or unsafe eval.');
  }
  const nativeManifest = JSON.parse(readFileSync(nativeHostManifest, 'utf8'));
  if (!Array.isArray(nativeManifest.allowed_origins) || !nativeManifest.allowed_origins.includes(STORE_ORIGIN)) {
    fail(`production native-host allowed_origins must contain ${STORE_ORIGIN}`);
  }
  const sha256 = createHash('sha256').update(readFileSync(zip)).digest('hex');
  const report = {
    candidateValid: true,
    artifact: resolve(zip),
    sha256,
    bytes: statSync(zip).size,
    version: manifest.version,
    sourceVersion,
    extensionId,
    requiredExtensionId: STORE_EXTENSION_ID,
    nativeHostOrigin: STORE_ORIGIN,
    files,
    permissions: manifest.permissions,
    optionalHostPermissions: manifest.optional_host_permissions,
    verificationCommand: `node scripts/verify-store-package.mjs --zip ${resolve(zip)} --public-key <base64-DER-public-key> --native-host-manifest ${resolve(nativeHostManifest)}`,
  };
  const reportPath = `${zip}.report.json`;
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`VALID Store candidate: ${zip}\nReport: ${reportPath}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
