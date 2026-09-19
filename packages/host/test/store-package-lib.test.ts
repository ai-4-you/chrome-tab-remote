import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  assertStorePublicKey,
  extensionIdFromPublicKey,
  remoteExecutableLoaderReason,
} from '../../../scripts/store-package-lib.mjs';

const developmentKey = JSON.parse(readFileSync('packages/extension/manifest.json', 'utf8')).key as string;

describe('Store public-key verification', () => {
  it('derives Chrome IDs from base64 DER public keys', () => {
    expect(extensionIdFromPublicKey(developmentKey)).toBe('nkgapnnfibaccdmmelpnekmdebkcbebk');
  });

  it('fails closed for a key that is not the required Store ID', () => {
    expect(() => assertStorePublicKey(developmentKey)).toThrow(
      'not required Store ID pkmcmaegiobodpogiankgdnghfejhpoh',
    );
  });

  it('allows ordinary URL literals but rejects remote executable loaders', () => {
    expect(remoteExecutableLoaderReason('const schema = "https://json-schema.org/draft/2020-12/schema";', 'bundle.js')).toBeUndefined();
    expect(remoteExecutableLoaderReason('import("https://example.test/module.js")', 'bundle.js')).toBe('remote dynamic import');
    expect(remoteExecutableLoaderReason('importScripts("//example.test/worker.js")', 'bundle.js')).toBe('remote importScripts');
    expect(remoteExecutableLoaderReason('<script src="https://example.test/app.js"></script>', 'panel.html')).toBe('remote script source');
  });
});
