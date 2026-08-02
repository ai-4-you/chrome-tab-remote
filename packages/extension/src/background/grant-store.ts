// Grant store — the single source of truth for Tab Grants.
// Persisted in chrome.storage.session: grants die with the browser session by design.
// Stage 1: the model is list-shaped (future-proof) but at most ONE grant may exist.
import type { Grant, GrantMode } from '@ctr/shared';
import { DEFAULT_GRANT_TTL_MS } from '@ctr/shared';

const STORAGE_KEY = 'ctrGrants';

async function readGrants(): Promise<Grant[]> {
  const data = await chrome.storage.session.get(STORAGE_KEY);
  const grants = data[STORAGE_KEY];
  return Array.isArray(grants) ? (grants as Grant[]) : [];
}

async function writeGrants(grants: Grant[]): Promise<void> {
  await chrome.storage.session.set({ [STORAGE_KEY]: grants });
}

export async function listGrants(): Promise<Grant[]> {
  return readGrants();
}

export async function getGrant(grantId: string): Promise<Grant | undefined> {
  return (await readGrants()).find((g) => g.grantId === grantId);
}

/**
 * Mint a new grant for one tab ('observe' by default; 'act' additionally
 * allows user-approved actions). Enforces the one-grant rule: any pre-existing
 * grant is replaced.
 */
export async function mintGrant(
  tabId: number,
  origin: string,
  now: number = Date.now(),
  mode: GrantMode = 'observe',
): Promise<Grant> {
  const grant: Grant = {
    grantId: crypto.randomUUID(),
    tabId,
    origin,
    mode,
    status: 'active',
    expiresAt: new Date(now + DEFAULT_GRANT_TTL_MS).toISOString(),
    createdByGesture: true,
  };
  await writeGrants([grant]);
  return grant;
}

/** Delete a grant. Returns the removed grant, or undefined if unknown. */
export async function revokeGrant(grantId: string): Promise<Grant | undefined> {
  const grants = await readGrants();
  const revoked = grants.find((g) => g.grantId === grantId);
  if (!revoked) return undefined;
  await writeGrants(grants.filter((g) => g.grantId !== grantId));
  return revoked;
}

/** Delete all grants pinned to a tab (tab close). Returns the removed grants. */
export async function revokeGrantsForTab(tabId: number): Promise<Grant[]> {
  const grants = await readGrants();
  const removed = grants.filter((g) => g.tabId === tabId);
  if (removed.length > 0) {
    await writeGrants(grants.filter((g) => g.tabId !== tabId));
  }
  return removed;
}

async function updateGrant(
  grantId: string,
  patch: Partial<Pick<Grant, 'status' | 'origin' | 'autoApprove'>>,
): Promise<Grant | undefined> {
  const grants = await readGrants();
  const existing = grants.find((g) => g.grantId === grantId);
  if (!existing) return undefined;
  const updated: Grant = { ...existing, ...patch };
  await writeGrants(grants.map((g) => (g.grantId === grantId ? updated : g)));
  return updated;
}

/**
 * Toggle auto-approve ("YOLO") on an act grant. Refused for observe grants —
 * there is nothing to auto-approve and the flag must never pre-exist a mode
 * upgrade. Returns the updated grant, or undefined if unknown/refused.
 */
export async function setAutoApprove(
  grantId: string,
  enabled: boolean,
): Promise<Grant | undefined> {
  const grant = await getGrant(grantId);
  if (!grant || grant.mode !== 'act') return undefined;
  return updateGrant(grantId, { autoApprove: enabled });
}

/** Origin-pin violation: keep the grant but make it unusable until re-confirmed. */
export async function suspendGrant(grantId: string): Promise<Grant | undefined> {
  return updateGrant(grantId, { status: 'suspended' });
}

/**
 * User re-confirmed a suspended grant: re-pin to the tab's current origin and
 * reactivate. Expiry is NOT extended — the original TTL stands (fail closed).
 */
export async function reconfirmGrant(
  grantId: string,
  origin: string,
): Promise<Grant | undefined> {
  return updateGrant(grantId, { origin, status: 'active' });
}
