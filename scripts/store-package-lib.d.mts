export const STORE_EXTENSION_ID: string;
export const STORE_ORIGIN: string;
export function extensionIdFromPublicKey(publicKeyBase64: string): string;
export function assertStorePublicKey(publicKeyBase64: string): string;
export function remoteExecutableLoaderReason(content: string, fileName: string): string | undefined;
