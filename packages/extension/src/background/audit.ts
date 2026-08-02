// Audit trail — capped ring buffer in chrome.storage.local plus forwarding to
// the native host (which persists JSONL). Every grant lifecycle event and every
// toolCall produces exactly one entry.
import type { AuditEntry } from '@ctr/shared';

const AUDIT_KEY = 'ctrAudit';
export const AUDIT_CAP = 500;

type AuditForwarder = (entry: AuditEntry) => void;
let forwarder: AuditForwarder | null = null;

/** Wire the native-port sender in (avoids an import cycle audit <-> native-port). */
export function setAuditForwarder(fn: AuditForwarder | null): void {
  forwarder = fn;
}

async function readAudit(): Promise<AuditEntry[]> {
  const data = await chrome.storage.local.get(AUDIT_KEY);
  const entries = data[AUDIT_KEY];
  return Array.isArray(entries) ? (entries as AuditEntry[]) : [];
}

export async function appendAudit(
  partial: Omit<AuditEntry, 'ts'> & { ts?: number },
): Promise<AuditEntry> {
  const { ts, ...rest } = partial;
  const entry: AuditEntry = { ts: ts ?? Date.now(), ...rest };
  const existing = await readAudit();
  const next = [...existing, entry].slice(-AUDIT_CAP);
  await chrome.storage.local.set({ [AUDIT_KEY]: next });
  forwarder?.(entry);
  return entry;
}

/** Latest entries, newest first. */
export async function getAudit(limit: number = AUDIT_CAP): Promise<AuditEntry[]> {
  const existing = await readAudit();
  return existing.slice(-limit).reverse();
}
