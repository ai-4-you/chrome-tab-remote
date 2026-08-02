// Approval gate — every mutating plan pauses here until the user decides in
// the side panel. A single action is a 1-step plan (C-10); the approved plan
// is FROZEN — the agent cannot deviate from the listed steps. ONE pending
// approval at a time; timeouts fail closed.
import { APPROVAL_TIMEOUT_MS } from '@ctr/shared';

export interface ApprovalStep {
  kind: 'click' | 'fill' | 'select';
  /** Human description of the target element, e.g. 'button "Save"'. */
  target: string;
  /** What would be typed/chosen — shown verbatim to the user before approving. */
  detail?: string;
}

export interface PendingApproval {
  opId: string;
  /** The frozen steps the user approves as a whole. */
  steps: ApprovalStep[];
  /** Origin of the granted tab the plan would run in. */
  origin: string;
  /** Epoch ms when the request auto-times-out. */
  deadline: number;
}

export type ApprovalDecision = 'approved' | 'denied' | 'timeout' | 'busy';

interface Waiter {
  pending: PendingApproval;
  resolve: (decision: ApprovalDecision) => void;
  timer: ReturnType<typeof setTimeout>;
}

let current: Waiter | null = null;
let notify: () => void = () => {};

/** The side panel is re-rendered on every pending/resolved transition. */
export function setApprovalNotifier(fn: () => void): void {
  notify = fn;
}

export function getPendingApproval(): PendingApproval | null {
  return current?.pending ?? null;
}

function finish(decision: ApprovalDecision): void {
  if (!current) return;
  clearTimeout(current.timer);
  const { resolve } = current;
  current = null;
  notify();
  resolve(decision);
}

/**
 * Propose one action for user approval. Resolves with the decision; resolves
 * 'busy' immediately when another proposal is already pending (strict
 * one-at-a-time — the agent is told to retry after it resolves).
 */
export function proposeApproval(
  proposal: Omit<PendingApproval, 'deadline'>,
  timeoutMs: number = APPROVAL_TIMEOUT_MS,
): Promise<ApprovalDecision> {
  if (current) return Promise.resolve('busy');
  return new Promise<ApprovalDecision>((resolve) => {
    const timer = setTimeout(() => finish('timeout'), timeoutMs);
    current = {
      pending: { ...proposal, deadline: Date.now() + timeoutMs },
      resolve,
      timer,
    };
    notify();
  });
}

/** User decision from the side panel. False when the opId is not the pending one. */
export function decideApproval(opId: string, approved: boolean): boolean {
  if (!current || current.pending.opId !== opId) return false;
  finish(approved ? 'approved' : 'denied');
  return true;
}
