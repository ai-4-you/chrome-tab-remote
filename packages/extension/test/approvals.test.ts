import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  decideApproval,
  getPendingApproval,
  proposeApproval,
  setApprovalNotifier,
} from '../src/background/approvals.js';

const PROPOSAL = {
  opId: 'op-1',
  tool: 'tab_click' as const,
  ref: 'n7',
  target: 'button "Save"',
  origin: 'https://app.example.com',
};

afterEach(() => {
  // Drain any pending approval so module state never leaks between tests.
  const pending = getPendingApproval();
  if (pending) decideApproval(pending.opId, false);
  setApprovalNotifier(() => {});
  vi.useRealTimers();
});

describe('approvals', () => {
  it('exposes the proposal while pending and resolves approved on user approval', async () => {
    const promise = proposeApproval(PROPOSAL);
    const pending = getPendingApproval();
    expect(pending).toMatchObject({ opId: 'op-1', tool: 'tab_click', target: 'button "Save"' });
    expect(pending!.deadline).toBeGreaterThan(Date.now());
    expect(decideApproval('op-1', true)).toBe(true);
    await expect(promise).resolves.toBe('approved');
    expect(getPendingApproval()).toBeNull();
  });

  it('resolves denied on user denial', async () => {
    const promise = proposeApproval(PROPOSAL);
    decideApproval('op-1', false);
    await expect(promise).resolves.toBe('denied');
  });

  it('ignores decisions for a different opId', async () => {
    const promise = proposeApproval(PROPOSAL);
    expect(decideApproval('other-op', true)).toBe(false);
    expect(getPendingApproval()).not.toBeNull();
    decideApproval('op-1', false);
    await promise;
  });

  it('times out (fails closed) without a decision', async () => {
    vi.useFakeTimers();
    const promise = proposeApproval(PROPOSAL, 5_000);
    vi.advanceTimersByTime(5_001);
    await expect(promise).resolves.toBe('timeout');
    expect(getPendingApproval()).toBeNull();
  });

  it('is strictly one-at-a-time: a second proposal resolves busy immediately', async () => {
    const first = proposeApproval(PROPOSAL);
    await expect(proposeApproval({ ...PROPOSAL, opId: 'op-2' })).resolves.toBe('busy');
    // The first proposal is untouched by the rejected second one.
    expect(getPendingApproval()?.opId).toBe('op-1');
    decideApproval('op-1', true);
    await expect(first).resolves.toBe('approved');
  });

  it('notifies the panel on every pending/resolved transition', async () => {
    const notify = vi.fn();
    setApprovalNotifier(notify);
    const promise = proposeApproval(PROPOSAL);
    expect(notify).toHaveBeenCalledTimes(1);
    decideApproval('op-1', true);
    expect(notify).toHaveBeenCalledTimes(2);
    await promise;
  });
});
