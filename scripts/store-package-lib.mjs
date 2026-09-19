import { createHash } from 'node:crypto';

export const STORE_EXTENSION_ID = 'pkmcmaegiobodpogiankgdnghfejhpoh';
export const STORE_ORIGIN = `chrome-extension://${STORE_EXTENSION_ID}/`;

/** Chrome derives an extension ID from the first 16 bytes of SHA-256(DER key). */
export function extensionIdFromPublicKey(publicKeyBase64) {
  if (typeof publicKeyBase64 !== 'string' || publicKeyBase64.trim() === '') {
    throw new Error('A base64 DER public key is required.');
  }
  const der = Buffer.from(publicKeyBase64.replace(/\s+/g, ''), 'base64');
  if (der.length === 0) throw new Error('Public key is not valid base64 DER.');
  const canonical = der.toString('base64');
  if (canonical !== publicKeyBase64.replace(/\s+/g, '')) {
    throw new Error('Public key is not canonical base64 DER.');
  }
  return createHash('sha256').update(der).digest('hex').slice(0, 32).replace(/[0-9a-f]/g, (n) =>
    String.fromCharCode('a'.charCodeAt(0) + Number.parseInt(n, 16)),
  );
}

export function assertStorePublicKey(publicKeyBase64) {
  const extensionId = extensionIdFromPublicKey(publicKeyBase64);
  if (extensionId !== STORE_EXTENSION_ID) {
    throw new Error(
      `Public key derives to ${extensionId}, not required Store ID ${STORE_EXTENSION_ID}.`,
    );
  }
  return extensionId;
}

/**
 * Detect remote executable loading, not ordinary URL literals. This is a
 * deliberately narrow package preflight; it does not claim to detect runtime
 * networking such as fetch().
 */
export function remoteExecutableLoaderReason(content, fileName) {
  if (typeof content !== 'string' || typeof fileName !== 'string') {
    throw new Error('Content and file name must be strings.');
  }
  const remote = '(?:https?:)?\\/\\/';
  const quote = "['\"\\x60]";
  const patterns = fileName.endsWith('.html')
    ? [
        ['remote script source', new RegExp(`<script\\b[^>]*\\bsrc\\s*=\\s*${quote}(?:${remote}|data:)`, 'iu')],
        ['remote modulepreload', new RegExp(`<link\\b[^>]*\\brel\\s*=\\s*${quote}modulepreload${quote}[^>]*\\bhref\\s*=\\s*${quote}${remote}`, 'iu')],
      ]
    : [
        ['remote static import', new RegExp(`\\bimport\\s+(?:[^;\\n]*?\\s+from\\s+)?${quote}${remote}`, 'iu')],
        ['remote dynamic import', new RegExp(`\\bimport\\s*\\(\\s*${quote}${remote}`, 'iu')],
        ['remote importScripts', new RegExp(`\\bimportScripts\\s*\\(\\s*${quote}${remote}`, 'iu')],
        ['remote worker source', new RegExp(`\\b(?:new\\s+)?(?:Shared)?Worker\\s*\\(\\s*${quote}${remote}`, 'iu')],
      ];
  return patterns.find(([, pattern]) => pattern.test(content))?.[0];
}
