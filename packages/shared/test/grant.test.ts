import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GRANT_TTL_MS,
  GrantSchema,
  isGrantUsable,
  type Grant,
} from '@ctr/shared';

const NOW = Date.parse('2026-08-02T12:00:00.000Z');

function makeGrant(overrides: Partial<Grant> = {}): Grant {
  return {
    grantId: '4b1c9c1e-8f2a-4f0e-9b1a-2c3d4e5f6a7b',
    tabId: 123,
    origin: 'https://app.example.com',
    mode: 'observe',
    status: 'active',
    expiresAt: new Date(NOW + DEFAULT_GRANT_TTL_MS).toISOString(),
    createdByGesture: true,
    ...overrides,
  };
}

describe('GrantSchema', () => {
  it('accepts a valid active grant', () => {
    expect(GrantSchema.parse(makeGrant())).toEqual(makeGrant());
  });

  it('accepts a suspended grant', () => {
    expect(GrantSchema.safeParse(makeGrant({ status: 'suspended' })).success).toBe(true);
  });

  it('rejects a non-uuid grantId', () => {
    expect(GrantSchema.safeParse(makeGrant({ grantId: 'not-a-uuid' })).success).toBe(false);
  });

  it('accepts mode act (Stage 2) and rejects unknown modes', () => {
    expect(GrantSchema.safeParse({ ...makeGrant(), mode: 'act' }).success).toBe(true);
    expect(GrantSchema.safeParse({ ...makeGrant(), mode: 'admin' }).success).toBe(false);
  });

  it('rejects unknown status', () => {
    const grant = { ...makeGrant(), status: 'revoked' };
    expect(GrantSchema.safeParse(grant).success).toBe(false);
  });

  it('rejects createdByGesture: false', () => {
    const grant = { ...makeGrant(), createdByGesture: false };
    expect(GrantSchema.safeParse(grant).success).toBe(false);
  });

  it('rejects a non-URL origin', () => {
    expect(GrantSchema.safeParse(makeGrant({ origin: 'app.example.com' })).success).toBe(false);
  });

  it('rejects a non-ISO expiresAt', () => {
    expect(GrantSchema.safeParse(makeGrant({ expiresAt: 'tomorrow' })).success).toBe(false);
  });

  it('rejects a fractional tabId', () => {
    expect(GrantSchema.safeParse(makeGrant({ tabId: 1.5 })).success).toBe(false);
  });

  it('rejects missing fields', () => {
    const { grantId: _grantId, ...rest } = makeGrant();
    expect(GrantSchema.safeParse(rest).success).toBe(false);
  });
});

describe('isGrantUsable', () => {
  it('returns ok for an active, unexpired grant', () => {
    expect(isGrantUsable(makeGrant(), NOW)).toEqual({ ok: true });
  });

  it('returns grant_expired when expiresAt is in the past', () => {
    const grant = makeGrant({ expiresAt: new Date(NOW - 1000).toISOString() });
    expect(isGrantUsable(grant, NOW)).toEqual({ ok: false, code: 'grant_expired' });
  });

  it('returns grant_expired when expiresAt is exactly now (fail closed)', () => {
    const grant = makeGrant({ expiresAt: new Date(NOW).toISOString() });
    expect(isGrantUsable(grant, NOW)).toEqual({ ok: false, code: 'grant_expired' });
  });

  it('returns grant_suspended for a suspended, unexpired grant', () => {
    const grant = makeGrant({ status: 'suspended' });
    expect(isGrantUsable(grant, NOW)).toEqual({ ok: false, code: 'grant_suspended' });
  });

  it('expiry wins over suspension', () => {
    const grant = makeGrant({
      status: 'suspended',
      expiresAt: new Date(NOW - 1).toISOString(),
    });
    expect(isGrantUsable(grant, NOW)).toEqual({ ok: false, code: 'grant_expired' });
  });

  it('defaults now to the current time', () => {
    const expired = makeGrant({ expiresAt: '2020-01-01T00:00:00.000Z' });
    expect(isGrantUsable(expired)).toEqual({ ok: false, code: 'grant_expired' });
  });
});

describe('DEFAULT_GRANT_TTL_MS', () => {
  it('is 30 minutes', () => {
    expect(DEFAULT_GRANT_TTL_MS).toBe(30 * 60 * 1000);
  });
});
