import { z } from 'zod';

/** Default grant lifetime: 30 minutes. */
export const DEFAULT_GRANT_TTL_MS = 30 * 60 * 1000;

/**
 * A Tab Grant — the capability token authorizing observation of exactly one tab.
 * Minted only from a user gesture in the side panel; stored in chrome.storage.session.
 * Stage 1: mode is always 'observe' and at most one grant is active.
 */
export const GrantSchema = z.object({
  grantId: z.string().uuid(),
  tabId: z.number().int().nonnegative(),
  /** Origin the grant is pinned to, e.g. "https://app.example.com". */
  origin: z.string().url(),
  mode: z.literal('observe'),
  status: z.enum(['active', 'suspended']),
  /** ISO-8601 timestamp; default now + DEFAULT_GRANT_TTL_MS at mint time. */
  expiresAt: z.string().datetime(),
  createdByGesture: z.literal(true),
});
export type Grant = z.infer<typeof GrantSchema>;

export type GrantUsable =
  | { ok: true }
  | { ok: false; code: 'grant_expired' | 'grant_suspended' };

/**
 * Check whether a grant may authorize a tool call right now.
 * Expiry wins over suspension: an expired grant is dead regardless of status.
 */
export function isGrantUsable(grant: Grant, now: number = Date.now()): GrantUsable {
  if (Date.parse(grant.expiresAt) <= now) {
    return { ok: false, code: 'grant_expired' };
  }
  if (grant.status === 'suspended') {
    return { ok: false, code: 'grant_suspended' };
  }
  return { ok: true };
}
