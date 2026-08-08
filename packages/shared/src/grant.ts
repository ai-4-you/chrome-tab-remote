import { z } from 'zod';

/** Default grant lifetime: 30 minutes. */
export const DEFAULT_GRANT_TTL_MS = 30 * 60 * 1000;

/** Grant modes: 'observe' is read-only; 'act' additionally allows user-approved actions. */
export const GRANT_MODES = ['observe', 'act'] as const;
export const GrantModeSchema = z.enum(GRANT_MODES);
export type GrantMode = z.infer<typeof GrantModeSchema>;

/**
 * A Tab Grant — the capability token authorizing observation of exactly one tab
 * (and, in 'act' mode, actions gated by per-action user approval).
 * Minted only from a user gesture in the side panel; stored in chrome.storage.session.
 * At most one grant is active.
 */
export const GrantSchema = z.object({
  grantId: z.string().uuid(),
  tabId: z.number().int().nonnegative(),
  /** Origin the grant is pinned to, e.g. "https://app.example.com". */
  origin: z.string().url(),
  mode: GrantModeSchema,
  /** Explicit, session-scoped consent to expose pixels from the visible tab viewport. */
  allowViewportScreenshot: z.boolean().default(false),
  /**
   * User-controlled "YOLO" switch (act grants only): actions execute WITHOUT
   * the per-action approval pause. Off by default; toggleable live in the side
   * panel; dies with the grant — every new grant starts strict.
   */
  autoApprove: z.boolean().optional(),
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
