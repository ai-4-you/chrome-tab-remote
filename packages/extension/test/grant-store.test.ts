import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_GRANT_TTL_MS } from '@ctr/shared';
import { installChromeMock } from './chrome-mock.js';
import {
  getGrant,
  listGrants,
  mintGrant,
  reconfirmGrant,
  revokeGrant,
  revokeGrantsForTab,
  suspendGrant,
} from '../src/background/grant-store.js';

const ORIGIN = 'https://app.example.com';

describe('grant-store', () => {
  beforeEach(() => {
    installChromeMock();
  });

  it('mints an active observe grant with a 30 min TTL', async () => {
    const now = Date.now();
    const grant = await mintGrant(7, ORIGIN, now);
    expect(grant.tabId).toBe(7);
    expect(grant.origin).toBe(ORIGIN);
    expect(grant.mode).toBe('observe');
    expect(grant.status).toBe('active');
    expect(grant.createdByGesture).toBe(true);
    expect(Date.parse(grant.expiresAt)).toBe(now + DEFAULT_GRANT_TTL_MS);
    expect(await getGrant(grant.grantId)).toEqual(grant);
  });

  it('enforces the one-grant rule: minting replaces any existing grant', async () => {
    const first = await mintGrant(1, ORIGIN);
    const second = await mintGrant(2, 'https://other.example.com');
    const grants = await listGrants();
    expect(grants).toHaveLength(1);
    expect(grants[0]?.grantId).toBe(second.grantId);
    expect(await getGrant(first.grantId)).toBeUndefined();
  });

  it('revokes a grant by id and reports unknown ids', async () => {
    const grant = await mintGrant(1, ORIGIN);
    expect(await revokeGrant('not-a-grant')).toBeUndefined();
    expect(await listGrants()).toHaveLength(1);
    const revoked = await revokeGrant(grant.grantId);
    expect(revoked?.grantId).toBe(grant.grantId);
    expect(await listGrants()).toHaveLength(0);
  });

  it('revokes grants when their tab closes', async () => {
    const grant = await mintGrant(42, ORIGIN);
    expect(await revokeGrantsForTab(99)).toHaveLength(0);
    const removed = await revokeGrantsForTab(42);
    expect(removed.map((g) => g.grantId)).toEqual([grant.grantId]);
    expect(await listGrants()).toHaveLength(0);
  });

  it('suspends on origin change and re-confirms with a re-pinned origin', async () => {
    const grant = await mintGrant(1, ORIGIN);

    const suspended = await suspendGrant(grant.grantId);
    expect(suspended?.status).toBe('suspended');
    expect((await getGrant(grant.grantId))?.status).toBe('suspended');

    const reconfirmed = await reconfirmGrant(grant.grantId, 'https://new.example.com');
    expect(reconfirmed?.status).toBe('active');
    expect(reconfirmed?.origin).toBe('https://new.example.com');
    // Expiry is NOT extended by re-confirmation.
    expect(reconfirmed?.expiresAt).toBe(grant.expiresAt);
  });

  it('returns undefined when suspending/reconfirming unknown grants', async () => {
    expect(await suspendGrant('nope')).toBeUndefined();
    expect(await reconfirmGrant('nope', ORIGIN)).toBeUndefined();
  });
});
