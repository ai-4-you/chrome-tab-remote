// Agent-initiated access requests (request_grant): the agent may ASK for a tab,
// but only the user's normal grant gesture answers — this module only carries
// the question. One request at a time; timeouts fail closed.
import { APPROVAL_TIMEOUT_MS, type GrantMode } from '@ctr/shared';

export interface PendingGrantRequest {
  /** Agent-supplied reason, shown verbatim to the user. */
  reason?: string;
  /**
   * Which capability the agent says it needs. A HINT only — the user's
   * checkbox at grant time is the sole decision; granting observe against an
   * act request is a valid answer. The panel renders act requests loudly.
   */
  requestedMode: GrantMode;
  /** Epoch ms when the request auto-times-out. */
  deadline: number;
}

export type GrantRequestOutcome = 'granted' | 'dismissed' | 'timeout' | 'busy';

interface Waiter {
  pending: PendingGrantRequest;
  resolve: (outcome: GrantRequestOutcome) => void;
  timer: ReturnType<typeof setTimeout>;
}

let current: Waiter | null = null;
let notify: () => void = () => {};

export function setGrantRequestNotifier(fn: () => void): void {
  notify = fn;
}

export function getPendingGrantRequest(): PendingGrantRequest | null {
  return current?.pending ?? null;
}

function finish(outcome: GrantRequestOutcome): void {
  if (!current) return;
  clearTimeout(current.timer);
  const { resolve } = current;
  current = null;
  notify();
  resolve(outcome);
}

/** Post one access request; resolves when the user grants, dismisses, or the window expires. */
export function proposeGrantRequest(
  reason: string | undefined,
  requestedMode: GrantMode = 'observe',
  timeoutMs: number = APPROVAL_TIMEOUT_MS,
): Promise<GrantRequestOutcome> {
  if (current) return Promise.resolve('busy');
  return new Promise<GrantRequestOutcome>((resolve) => {
    const timer = setTimeout(() => finish('timeout'), timeoutMs);
    current = { pending: { reason, requestedMode, deadline: Date.now() + timeoutMs }, resolve, timer };
    notify();
  });
}

/** Called by the grant flow: a fresh grant answers any pending request. */
export function grantRequestGranted(): void {
  finish('granted');
}

/** User dismissed the request card in the panel. */
export function dismissGrantRequest(): boolean {
  if (!current) return false;
  finish('dismissed');
  return true;
}
