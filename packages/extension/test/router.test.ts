import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolCallRequest } from '@ctr/shared';
import { installChromeMock, type ChromeMock } from './chrome-mock.js';
import {
  getGrant,
  listGrants,
  mintGrant,
  revokeGrant,
  setAutoApprove,
  suspendGrant,
} from '../src/background/grant-store.js';
import { getAudit } from '../src/background/audit.js';
import { decideApproval, getPendingApproval } from '../src/background/approvals.js';
import {
  dismissGrantRequest,
  getPendingGrantRequest,
  grantRequestGranted,
} from '../src/background/grant-requests.js';
import { handleToolCall } from '../src/background/router.js';

const ORIGIN = 'https://app.example.com';

function call(tool: ToolCallRequest['tool'], params: Record<string, unknown> = {}): ToolCallRequest {
  return { id: 'req-1', kind: 'toolCall', tool, params };
}

describe('router', () => {
  let mock: ChromeMock;

  beforeEach(() => {
    mock = installChromeMock();
  });

  function expectError(res: Awaited<ReturnType<typeof handleToolCall>>, code: string) {
    expect(res.kind).toBe('toolResult');
    if (res.ok) throw new Error('expected an error result');
    expect(res.error.code).toBe(code);
  }

  it('list_grants returns the grant list without needing a grantId', async () => {
    const grant = await mintGrant(1, ORIGIN);
    const res = await handleToolCall(call('list_grants'));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result).toEqual({ grants: [grant] });
  });

  it('rejects with no_grant when grantId is missing or unknown', async () => {
    expectError(await handleToolCall(call('tab_snapshot')), 'no_grant');
    expectError(
      await handleToolCall(call('tab_snapshot', { grantId: 'unknown-id' })),
      'no_grant',
    );
  });

  it('rejects with grant_expired when the grant TTL has passed', async () => {
    const past = Date.now() - 60 * 60 * 1000; // minted an hour ago -> expired
    const grant = await mintGrant(1, ORIGIN, past);
    expectError(
      await handleToolCall(call('tab_snapshot', { grantId: grant.grantId })),
      'grant_expired',
    );
  });

  it('rejects with grant_suspended when the grant is suspended', async () => {
    const grant = await mintGrant(1, ORIGIN);
    await suspendGrant(grant.grantId);
    expectError(
      await handleToolCall(call('tab_snapshot', { grantId: grant.grantId })),
      'grant_suspended',
    );
  });

  it('revokes the grant and rejects with grant_revoked when the tab is gone', async () => {
    const grant = await mintGrant(1, ORIGIN);
    // tabs.get default mock rejects (no tab).
    expectError(
      await handleToolCall(call('tab_snapshot', { grantId: grant.grantId })),
      'grant_revoked',
    );
    expect(await listGrants()).toHaveLength(0);
  });

  it('suspends the grant when the tab origin no longer matches the pin', async () => {
    const grant = await mintGrant(1, ORIGIN);
    mock.tabs.get.mockResolvedValue({ id: 1, url: 'https://evil.example.net/page' });
    expectError(
      await handleToolCall(call('tab_snapshot', { grantId: grant.grantId })),
      'grant_suspended',
    );
    expect((await getGrant(grant.grantId))?.status).toBe('suspended');
  });

  it('happy path: forwards tab_snapshot to the content script and audits it', async () => {
    const grant = await mintGrant(1, ORIGIN);
    mock.tabs.get.mockResolvedValue({ id: 1, url: `${ORIGIN}/dashboard` });
    const snapshot = { url: `${ORIGIN}/dashboard`, title: 'Dash', truncated: false };
    mock.tabs.sendMessage.mockResolvedValue({ ok: true, result: snapshot });

    const res = await handleToolCall(call('tab_snapshot', { grantId: grant.grantId }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result).toEqual(snapshot);
    expect(mock.tabs.sendMessage).toHaveBeenCalledWith(1, { type: 'ctrSnapshot', filter: 'full' });

    const audit = await getAudit();
    expect(audit[0]).toMatchObject({
      type: 'tool_call',
      tool: 'tab_snapshot',
      grantId: grant.grantId,
      tabId: 1,
      ok: true,
    });
  });

  it('rejects viewport screenshots unless the grant explicitly allows them', async () => {
    const grant = await mintGrant(1, ORIGIN);
    mock.tabs.get.mockResolvedValue({ id: 1, url: `${ORIGIN}/`, active: true, windowId: 7 });

    expectError(await handleToolCall(call('tab_screenshot_viewport', { grantId: grant.grantId })), 'screenshot_not_allowed');
    expect(mock.tabs.captureVisibleTab).not.toHaveBeenCalled();
  });

  it('captures only an allowed granted tab that is already active in its window', async () => {
    const grant = await mintGrant(1, ORIGIN, Date.now(), 'observe', true);
    mock.tabs.get.mockResolvedValue({
      id: 1,
      url: `${ORIGIN}/dashboard`,
      title: 'Dashboard',
      active: true,
      windowId: 7,
    });
    mock.tabs.captureVisibleTab.mockResolvedValue('data:image/jpeg;base64,aGVsbG8=');
    mock.tabs.query.mockResolvedValue([{ id: 1, url: `${ORIGIN}/dashboard`, active: true, windowId: 7 }]);

    const res = await handleToolCall(call('tab_screenshot_viewport', { grantId: grant.grantId }));

    expect(res).toMatchObject({
      ok: true,
      result: {
        mimeType: 'image/jpeg',
        data: 'aGVsbG8=',
        url: `${ORIGIN}/dashboard`,
        title: 'Dashboard',
      },
    });
    expect(mock.tabs.captureVisibleTab).toHaveBeenCalledWith(7, { format: 'jpeg', quality: 50 });
  });

  it('discards a capture if the grant is revoked while capture is pending', async () => {
    const grant = await mintGrant(1, ORIGIN, Date.now(), 'observe', true);
    mock.tabs.get.mockResolvedValue({ id: 1, url: `${ORIGIN}/`, active: true, windowId: 7 });
    mock.tabs.captureVisibleTab.mockImplementation(async () => {
      await revokeGrant(grant.grantId);
      return 'data:image/jpeg;base64,aGVsbG8=';
    });

    expectError(await handleToolCall(call('tab_screenshot_viewport', { grantId: grant.grantId })), 'no_grant');
  });

  it('discards a capture if another tab became active during the capture call', async () => {
    const grant = await mintGrant(1, ORIGIN, Date.now(), 'observe', true);
    mock.tabs.get.mockResolvedValue({ id: 1, url: `${ORIGIN}/`, active: true, windowId: 7 });
    mock.tabs.captureVisibleTab.mockResolvedValue('data:image/jpeg;base64,aGVsbG8=');
    mock.tabs.query.mockResolvedValue([{ id: 2, url: 'https://other.example/', active: true, windowId: 7 }]);

    expectError(await handleToolCall(call('tab_screenshot_viewport', { grantId: grant.grantId })), 'tab_not_visible');
  });

  it('refuses to capture when the granted tab is not active, without changing focus', async () => {
    const grant = await mintGrant(1, ORIGIN, Date.now(), 'observe', true);
    mock.tabs.get.mockResolvedValue({ id: 1, url: `${ORIGIN}/`, active: false, windowId: 7 });

    expectError(await handleToolCall(call('tab_screenshot_viewport', { grantId: grant.grantId })), 'tab_not_visible');
    expect(mock.tabs.captureVisibleTab).not.toHaveBeenCalled();
  });

  it('resolves an omitted grantId to the single existing grant and audits it', async () => {
    const grant = await mintGrant(1, ORIGIN);
    mock.tabs.get.mockResolvedValue({ id: 1, url: `${ORIGIN}/` });
    mock.tabs.sendMessage.mockResolvedValue({ ok: true, result: { title: 'Dash' } });

    const res = await handleToolCall(call('tab_snapshot'));
    expect(res.ok).toBe(true);

    const audit = await getAudit();
    expect(audit[0]).toMatchObject({ type: 'tool_call', tool: 'tab_snapshot', grantId: grant.grantId, ok: true });
  });

  it('passes filter=interactive through to the content script; anything else becomes full', async () => {
    const grant = await mintGrant(1, ORIGIN);
    mock.tabs.get.mockResolvedValue({ id: 1, url: `${ORIGIN}/` });
    mock.tabs.sendMessage.mockResolvedValue({ ok: true, result: {} });

    await handleToolCall(call('tab_snapshot', { grantId: grant.grantId, filter: 'interactive' }));
    expect(mock.tabs.sendMessage).toHaveBeenLastCalledWith(1, { type: 'ctrSnapshot', filter: 'interactive' });

    await handleToolCall(call('tab_snapshot', { grantId: grant.grantId, filter: 'bogus' }));
    expect(mock.tabs.sendMessage).toHaveBeenLastCalledWith(1, { type: 'ctrSnapshot', filter: 'full' });
  });

  it('happy path: forwards tab_read with the ref', async () => {
    const grant = await mintGrant(1, ORIGIN);
    mock.tabs.get.mockResolvedValue({ id: 1, url: `${ORIGIN}/` });
    mock.tabs.sendMessage.mockResolvedValue({ ok: true, result: { ref: 'n3', text: 'hello' } });

    const res = await handleToolCall(call('tab_read', { grantId: grant.grantId, ref: 'n3' }));
    expect(res.ok).toBe(true);
    expect(mock.tabs.sendMessage).toHaveBeenCalledWith(1, { type: 'ctrRead', ref: 'n3' });
  });

  it('maps a content-script error (unknown_ref) through to the tool result', async () => {
    const grant = await mintGrant(1, ORIGIN);
    mock.tabs.get.mockResolvedValue({ id: 1, url: `${ORIGIN}/` });
    mock.tabs.sendMessage.mockResolvedValue({
      ok: false,
      error: { code: 'unknown_ref', message: 'Unknown ref: n999' },
    });
    expectError(
      await handleToolCall(call('tab_read', { grantId: grant.grantId, ref: 'n999' })),
      'unknown_ref',
    );
  });

  it('rejects tab_read without a ref parameter as unknown_ref', async () => {
    const grant = await mintGrant(1, ORIGIN);
    mock.tabs.get.mockResolvedValue({ id: 1, url: `${ORIGIN}/` });
    expectError(
      await handleToolCall(call('tab_read', { grantId: grant.grantId })),
      'unknown_ref',
    );
  });

  it('rejects with tab_unreachable when the content script does not respond', async () => {
    const grant = await mintGrant(1, ORIGIN);
    mock.tabs.get.mockResolvedValue({ id: 1, url: `${ORIGIN}/` });
    // tabs.sendMessage default mock rejects (no receiver).
    expectError(
      await handleToolCall(call('tab_snapshot', { grantId: grant.grantId })),
      'tab_unreachable',
    );
  });

  it('re-injects the content script and retries once after a same-origin reload', async () => {
    const grant = await mintGrant(1, ORIGIN);
    mock.tabs.get.mockResolvedValue({ id: 1, url: `${ORIGIN}/dashboard` });
    const snapshot = { url: `${ORIGIN}/dashboard`, title: 'Dash', truncated: false };
    // First delivery fails (content script lost by reload), retry succeeds.
    mock.tabs.sendMessage
      .mockRejectedValueOnce(new Error('Could not establish connection.'))
      .mockResolvedValueOnce({ ok: true, result: snapshot });

    const res = await handleToolCall(call('tab_snapshot', { grantId: grant.grantId }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result).toEqual(snapshot);
    expect(mock.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 1 },
      files: ['content.js'],
    });
    expect(mock.tabs.sendMessage).toHaveBeenCalledTimes(2);
  });

  it('reports tab_unreachable when re-injection also fails', async () => {
    const grant = await mintGrant(1, ORIGIN);
    mock.tabs.get.mockResolvedValue({ id: 1, url: `${ORIGIN}/` });
    // sendMessage default mock always rejects; injection fails too.
    mock.scripting.executeScript.mockRejectedValue(new Error('cannot inject'));
    expectError(
      await handleToolCall(call('tab_snapshot', { grantId: grant.grantId })),
      'tab_unreachable',
    );
  });

  it('audits failed tool calls with the error code as detail', async () => {
    await handleToolCall(call('tab_snapshot', { grantId: 'unknown-id' }));
    const audit = await getAudit();
    expect(audit[0]).toMatchObject({
      type: 'tool_call',
      tool: 'tab_snapshot',
      ok: false,
      detail: 'no_grant',
    });
  });

  describe('act tools (approval gate)', () => {
    const ACTION_RESULT = {
      executed: [{ action: 'click', ref: 'n7', target: 'button "Save"' }],
      pageState: 'settled',
    };

    afterEach(() => {
      const pending = getPendingApproval();
      if (pending) decideApproval(pending.opId, false);
    });

    async function mintActGrant() {
      const grant = await mintGrant(1, ORIGIN, Date.now(), 'act');
      mock.tabs.get.mockResolvedValue({ id: 1, url: `${ORIGIN}/` });
      return grant;
    }

    it('rejects act tools on observe grants with observe_only, before any tab contact', async () => {
      await mintGrant(1, ORIGIN);
      mock.tabs.get.mockResolvedValue({ id: 1, url: `${ORIGIN}/` });
      expectError(await handleToolCall(call('tab_click', { ref: 'n7' })), 'observe_only');
      expect(mock.tabs.sendMessage).not.toHaveBeenCalled();
    });

    it('executes an approved click: describe → approval → re-validate → execute, fully audited', async () => {
      const grant = await mintActGrant();
      mock.tabs.sendMessage
        .mockResolvedValueOnce({ ok: true, result: { target: 'button "Save"' } }) // ctrDescribe
        .mockResolvedValueOnce({ ok: true, result: ACTION_RESULT }); // ctrAction

      const promise = handleToolCall(call('tab_click', { ref: 'n7' }));
      await vi.waitFor(() => expect(getPendingApproval()).not.toBeNull());
      const pending = getPendingApproval()!;
      expect(pending).toMatchObject({
        steps: [{ kind: 'click', target: 'button "Save"' }],
        origin: ORIGIN,
      });
      decideApproval(pending.opId, true);

      const res = await promise;
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.result).toEqual(ACTION_RESULT);
      expect(mock.tabs.sendMessage).toHaveBeenNthCalledWith(1, 1, { type: 'ctrDescribe', ref: 'n7' });
      expect(mock.tabs.sendMessage).toHaveBeenNthCalledWith(2, 1, {
        type: 'ctrPlan',
        steps: [{ kind: 'click', ref: 'n7' }],
      });

      const auditEntries = await getAudit();
      const types = auditEntries.map((e) => e.type);
      expect(types).toContain('action_proposed');
      expect(types).toContain('action_approved');
      expect(auditEntries[0]).toMatchObject({ type: 'tool_call', tool: 'tab_click', grantId: grant.grantId, tabId: 1, ok: true });
      // Every act-flow entry is stamped with the granted tab (per-tab audit view).
      for (const entry of auditEntries.filter((e) => e.type.startsWith('action_'))) {
        expect(entry.tabId).toBe(1);
      }
    });

    it('denial fails closed with approval_denied and never touches the page', async () => {
      await mintActGrant();
      mock.tabs.sendMessage.mockResolvedValueOnce({ ok: true, result: { target: 'button "Save"' } });

      const promise = handleToolCall(call('tab_click', { ref: 'n7' }));
      await vi.waitFor(() => expect(getPendingApproval()).not.toBeNull());
      decideApproval(getPendingApproval()!.opId, false);

      expectError(await promise, 'approval_denied');
      // Only the describe call reached the tab — no ctrAction.
      expect(mock.tabs.sendMessage).toHaveBeenCalledTimes(1);
      expect((await getAudit()).map((e) => e.type)).toContain('action_denied');
    });

    it('shows the fill text to the user via the approval detail', async () => {
      await mintActGrant();
      mock.tabs.sendMessage.mockResolvedValueOnce({ ok: true, result: { target: 'textbox "Search"' } });
      const promise = handleToolCall(call('tab_fill', { ref: 'n5', text: 'apples' }));
      await vi.waitFor(() => expect(getPendingApproval()).not.toBeNull());
      expect(getPendingApproval()!.steps[0]?.detail).toBe('type "apples"');
      decideApproval(getPendingApproval()!.opId, false);
      await promise;
    });

    it('rejects stale refs at the describe step WITHOUT bothering the user', async () => {
      await mintActGrant();
      mock.tabs.sendMessage.mockResolvedValueOnce({
        ok: false,
        error: { code: 'stale_ref', message: 'Ref n7 is from an older snapshot.' },
      });
      expectError(await handleToolCall(call('tab_click', { ref: 'n7' })), 'stale_ref');
      expect(getPendingApproval()).toBeNull();
    });

    it('re-validates after approval: a grant revoked during the wait yields no_grant, no execution', async () => {
      const grant = await mintActGrant();
      mock.tabs.sendMessage.mockResolvedValueOnce({ ok: true, result: { target: 'button "Save"' } });

      const promise = handleToolCall(call('tab_click', { ref: 'n7' }));
      await vi.waitFor(() => expect(getPendingApproval()).not.toBeNull());
      await revokeGrant(grant.grantId); // user revokes while the approval card is up
      decideApproval(getPendingApproval()!.opId, true);

      expectError(await promise, 'no_grant');
      expect(mock.tabs.sendMessage).toHaveBeenCalledTimes(1); // describe only, no ctrAction
    });

    it('auto-approve (Freaky mode) skips the gate, executes immediately, and audits it', async () => {
      const grant = await mintActGrant();
      await setAutoApprove(grant.grantId, true);
      mock.tabs.sendMessage
        .mockResolvedValueOnce({ ok: true, result: { target: 'button "Save"' } }) // ctrDescribe
        .mockResolvedValueOnce({ ok: true, result: ACTION_RESULT }); // ctrAction

      const res = await handleToolCall(call('tab_click', { ref: 'n7' }));
      expect(res.ok).toBe(true);
      // No approval was ever pending.
      expect(getPendingApproval()).toBeNull();

      const types = (await getAudit()).map((e) => e.type);
      expect(types).toContain('action_auto_approved');
      expect(types).not.toContain('action_proposed');
    });

    it('disabling auto-approve restores the gate for the next action', async () => {
      const grant = await mintActGrant();
      await setAutoApprove(grant.grantId, true);
      await setAutoApprove(grant.grantId, false);
      mock.tabs.sendMessage.mockResolvedValueOnce({ ok: true, result: { target: 'button "Save"' } });

      const promise = handleToolCall(call('tab_click', { ref: 'n7' }));
      await vi.waitFor(() => expect(getPendingApproval()).not.toBeNull());
      decideApproval(getPendingApproval()!.opId, false);
      expectError(await promise, 'approval_denied');
    });

    it('tab_plan: one approval for the whole frozen step list, executed as one ctrPlan', async () => {
      await mintActGrant();
      mock.tabs.sendMessage
        .mockResolvedValueOnce({ ok: true, result: { target: 'textbox "Name"' } }) // describe step 1
        .mockResolvedValueOnce({ ok: true, result: { target: 'button "Save"' } }) // describe step 2
        .mockResolvedValueOnce({
          ok: true,
          result: {
            executed: [
              { action: 'fill', ref: 'n5', target: 'textbox "Name"', text: 'Ada' },
              { action: 'click', ref: 'n7', target: 'button "Save"' },
            ],
            pageState: 'settled',
          },
        });

      const steps = [
        { kind: 'fill', ref: 'n5', text: 'Ada' },
        { kind: 'click', ref: 'n7' },
      ];
      const promise = handleToolCall(call('tab_plan', { steps }));
      await vi.waitFor(() => expect(getPendingApproval()).not.toBeNull());
      const pending = getPendingApproval()!;
      expect(pending.steps).toEqual([
        { kind: 'fill', target: 'textbox "Name"', detail: 'type "Ada"' },
        { kind: 'click', target: 'button "Save"', detail: undefined },
      ]);
      decideApproval(pending.opId, true);

      const res = await promise;
      expect(res.ok).toBe(true);
      expect(mock.tabs.sendMessage).toHaveBeenLastCalledWith(1, { type: 'ctrPlan', steps });
    });

    it('tab_plan rejects malformed step lists before any tab contact', async () => {
      await mintActGrant();
      expectError(await handleToolCall(call('tab_plan', { steps: [] })), 'invalid_target');
      expectError(await handleToolCall(call('tab_plan', { steps: [{ kind: 'jump', ref: 'n1' }] })), 'invalid_target');
      expectError(await handleToolCall(call('tab_plan', { steps: [{ kind: 'fill', ref: 'n1' }] })), 'invalid_target');
      expect(mock.tabs.sendMessage).not.toHaveBeenCalled();
    });

    it('reports busy (dedicated code) while another approval is pending', async () => {
      await mintActGrant();
      mock.tabs.sendMessage.mockResolvedValue({ ok: true, result: { target: 'button "Save"' } });
      const first = handleToolCall(call('tab_click', { ref: 'n7' }));
      await vi.waitFor(() => expect(getPendingApproval()).not.toBeNull());
      const second = await handleToolCall(call('tab_click', { ref: 'n8' }));
      expectError(second, 'busy');
      decideApproval(getPendingApproval()!.opId, false);
      await first;
    });
  });

  describe('tab_find', () => {
    it('forwards query and role to the content script', async () => {
      const grant = await mintGrant(1, ORIGIN);
      mock.tabs.get.mockResolvedValue({ id: 1, url: `${ORIGIN}/` });
      mock.tabs.sendMessage.mockResolvedValue({
        ok: true,
        result: { url: `${ORIGIN}/`, title: 'X', total: 0, matches: [] },
      });
      const res = await handleToolCall(call('tab_find', { grantId: grant.grantId, query: 'login', role: 'button' }));
      expect(res.ok).toBe(true);
      expect(mock.tabs.sendMessage).toHaveBeenCalledWith(1, { type: 'ctrFind', query: 'login', role: 'button' });
    });

    it('rejects a missing query', async () => {
      await mintGrant(1, ORIGIN);
      mock.tabs.get.mockResolvedValue({ id: 1, url: `${ORIGIN}/` });
      expectError(await handleToolCall(call('tab_find')), 'unknown_ref');
    });
  });

  describe('request_grant', () => {
    afterEach(() => {
      dismissGrantRequest();
    });

    it('returns the existing grant immediately when one is active', async () => {
      const grant = await mintGrant(1, ORIGIN);
      const res = await handleToolCall(call('request_grant'));
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.result).toEqual({ grants: [grant] });
      expect(getPendingGrantRequest()).toBeNull();
    });

    it('posts a pending request with reason + requested mode and resolves when the user grants', async () => {
      const promise = handleToolCall(call('request_grant', { reason: 'need the docs page', mode: 'act' }));
      await vi.waitFor(() => expect(getPendingGrantRequest()).not.toBeNull());
      expect(getPendingGrantRequest()?.reason).toBe('need the docs page');
      expect(getPendingGrantRequest()?.requestedMode).toBe('act');

      const grant = await mintGrant(1, ORIGIN); // the user grants a tab of their choice
      grantRequestGranted();
      const res = await promise;
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.result).toEqual({ grants: [grant] });
    });

    it('defaults the requested mode to observe and fails closed on dismissal', async () => {
      const promise = handleToolCall(call('request_grant'));
      await vi.waitFor(() => expect(getPendingGrantRequest()).not.toBeNull());
      expect(getPendingGrantRequest()?.requestedMode).toBe('observe');
      expect(dismissGrantRequest()).toBe(true);
      const res = await promise;
      expectError(res, 'no_grant');
      if (res.ok) return;
      expect(res.error.message).toContain('dismissed');
    });
  });
});
