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
  setAutoApprove,
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
    expect(grant.allowViewportScreenshot).toBe(false);
    expect(grant.status).toBe('active');
    expect(grant.createdByGesture).toBe(true);
    expect(Date.parse(grant.expiresAt)).toBe(now + DEFAULT_GRANT_TTL_MS);
    expect(await getGrant(grant.grantId)).toEqual(grant);
  });

  it('defaults viewport screenshot consent to false for a persisted legacy grant', async () => {
    const grant = await mintGrant(7, ORIGIN);
    const { allowViewportScreenshot: _omitted, ...legacyGrant } = grant;
    await chrome.storage.session.set({ ctrGrants: [legacyGrant] });

    expect((await getGrant(grant.grantId))?.allowViewportScreenshot).toBe(false);
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

  it('toggles auto-approve on act grants only; new grants always start strict', async () => {
    const observe = await mintGrant(1, ORIGIN);
    expect(await setAutoApprove(observe.grantId, true)).toBeUndefined();
    expect((await getGrant(observe.grantId))?.autoApprove).toBeUndefined();

    const act = await mintGrant(1, ORIGIN, Date.now(), 'act');
    expect(act.autoApprove).toBeUndefined(); // strict by default
    expect((await setAutoApprove(act.grantId, true))?.autoApprove).toBe(true);
    expect((await setAutoApprove(act.grantId, false))?.autoApprove).toBe(false);

    // Replacement mints a fresh strict grant — Freaky mode never survives.
    const replacement = await mintGrant(1, ORIGIN, Date.now(), 'act');
    expect(replacement.autoApprove).toBeUndefined();
  });

  it('mints a grant with allowNavigate pass-through', async () => {
    const grant = await mintGrant(1, ORIGIN, Date.now(), 'act', false, true);
    expect(grant.allowNavigate).toBe(true);
    expect((await getGrant(grant.grantId))?.allowNavigate).toBe(true);

    const defaultGrant = await mintGrant(1, ORIGIN, Date.now(), 'act');
    expect(defaultGrant.allowNavigate).toBe(false);
  });

  it('normalizes a legacy grant without allowNavigate to false', async () => {
    const grant = await mintGrant(1, ORIGIN, Date.now(), 'act', false, true);
    const { allowNavigate: _omitted, ...legacyGrant } = grant;
    await chrome.storage.session.set({ ctrGrants: [legacyGrant] });
    expect((await getGrant(grant.grantId))?.allowNavigate).toBe(false);
  });

  it('§2.7: re-pin to a DIFFERENT origin force-resets autoApprove + allowViewportScreenshot', async () => {
    // Mint an act grant with Freaky + screenshots ON.
    const grant = await mintGrant(1, ORIGIN, Date.now(), 'act', true, true);
    await setAutoApprove(grant.grantId, true);
    expect((await getGrant(grant.grantId))?.autoApprove).toBe(true);
    expect((await getGrant(grant.grantId))?.allowViewportScreenshot).toBe(true);
    expect((await getGrant(grant.grantId))?.allowNavigate).toBe(true);

    // Suspend + re-pin to a different origin.
    await suspendGrant(grant.grantId);
    const reconfirmed = await reconfirmGrant(grant.grantId, 'https://new.example.com');
    expect(reconfirmed?.origin).toBe('https://new.example.com');
    expect(reconfirmed?.status).toBe('active');
    // §2.7: high-risk flags reset on the new origin.
    expect(reconfirmed?.autoApprove).toBe(false);
    expect(reconfirmed?.allowViewportScreenshot).toBe(false);
    // mode + allowNavigate persist.
    expect(reconfirmed?.mode).toBe('act');
    expect(reconfirmed?.allowNavigate).toBe(true);
  });

  it('§2.7: re-pin to the SAME origin does NOT reset (chrome-error recovery)', async () => {
    const grant = await mintGrant(1, ORIGIN, Date.now(), 'act', true, true);
    await setAutoApprove(grant.grantId, true);
    expect((await getGrant(grant.grantId))?.autoApprove).toBe(true);

    // Suspend (e.g. chrome-error) and re-pin to the SAME origin.
    await suspendGrant(grant.grantId);
    const reconfirmed = await reconfirmGrant(grant.grantId, ORIGIN);
    expect(reconfirmed?.origin).toBe(ORIGIN);
    expect(reconfirmed?.status).toBe('active');
    // No reset: the high-risk flags survive same-origin re-confirm.
    expect(reconfirmed?.autoApprove).toBe(true);
    expect(reconfirmed?.allowViewportScreenshot).toBe(true);
  });

  it('§2.7: re-pin force-sets false even when stored true (F1 regression)', async () => {
    const grant = await mintGrant(1, ORIGIN, Date.now(), 'act', true, true);
    await setAutoApprove(grant.grantId, true);
    // Directly set the stored flags to true (simulating a stale toggle state).
    expect((await getGrant(grant.grantId))?.autoApprove).toBe(true);
    expect((await getGrant(grant.grantId))?.allowViewportScreenshot).toBe(true);

    // Re-pin to a different origin: the force-set must override the stored true.
    await suspendGrant(grant.grantId);
    const reconfirmed = await reconfirmGrant(grant.grantId, 'https://stale-toggle.example.com');
    expect(reconfirmed?.autoApprove).toBe(false);
    expect(reconfirmed?.allowViewportScreenshot).toBe(false);
  });
});
