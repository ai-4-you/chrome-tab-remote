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

  it('forwards tab_read_many through the same observe path, including an act grant', async () => {
    const grant = await mintGrant(1, ORIGIN, Date.now(), 'act');
    mock.tabs.get.mockResolvedValue({ id: 1, url: `${ORIGIN}/` });
    mock.tabs.sendMessage.mockResolvedValue({
      ok: true,
      result: { results: [{ ref: 'n3', ok: true, entry: { text: 'hello' } }] },
    });

    const res = await handleToolCall(call('tab_read_many', { grantId: grant.grantId, refs: ['n3'] }));
    expect(res.ok).toBe(true);
    expect(mock.tabs.sendMessage).toHaveBeenCalledWith(1, { type: 'ctrReadMany', refs: ['n3'] });
  });

  it('rejects malformed tab_read_many refs before contacting the content script', async () => {
    const grant = await mintGrant(1, ORIGIN);
    mock.tabs.get.mockResolvedValue({ id: 1, url: `${ORIGIN}/` });
    expectError(await handleToolCall(call('tab_read_many', { grantId: grant.grantId, refs: [] })), 'invalid_target');
    expect(mock.tabs.sendMessage).not.toHaveBeenCalled();
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

    it('executes an approved click as a receipt: describe → approval → re-validate → execute, fully audited', async () => {
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
      expect(res.result).not.toHaveProperty('snapshot');
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

    it('returns an interrupted receipt without a recovery snapshot when action delivery is lost', async () => {
      const grant = await mintActGrant();
      await setAutoApprove(grant.grantId, true);
      mock.tabs.sendMessage
        .mockResolvedValueOnce({ ok: true, result: { target: 'button "Save"' } }) // ctrDescribe
        .mockRejectedValueOnce(new Error('content script unloaded')); // ctrPlan

      const res = await handleToolCall(call('tab_click', { ref: 'n7' }));

      expect(res).toMatchObject({ ok: true, result: { executed: [], pageState: 'interrupted' } });
      if (!res.ok) return;
      expect(res.result).not.toHaveProperty('snapshot');
      expect(mock.tabs.sendMessage).toHaveBeenCalledTimes(2);
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

    // --- tab_scroll (C-2): page mode is a static target, element mode is a ref ---

    const SCROLL_RECEIPT = {
      executed: [
        {
          action: 'scroll',
          ref: 'page',
          target: 'div.feed',
          scrollMetrics: { scrollTop: 800, scrollHeight: 5000, clientHeight: 900, atBottom: false },
        },
      ],
      pageState: 'settled',
    };

    it('tab_scroll page mode: no ctrDescribe, one approval, static target on the card', async () => {
      await mintActGrant();
      mock.tabs.sendMessage.mockResolvedValueOnce({ ok: true, result: SCROLL_RECEIPT });

      const promise = handleToolCall(call('tab_scroll', { direction: 'down', pixels: 800 }));
      await vi.waitFor(() => expect(getPendingApproval()).not.toBeNull());
      const pending = getPendingApproval()!;
      expect(pending.steps).toEqual([
        {
          kind: 'scroll',
          target: 'page down 800px',
          detail: 'down 800px (page scroller or inner feed container)',
        },
      ]);
      decideApproval(pending.opId, true);

      const res = await promise;
      expect(res.ok).toBe(true);
      // The static target means exactly ONE tab message: the plan itself.
      expect(mock.tabs.sendMessage).toHaveBeenCalledTimes(1);
      expect(mock.tabs.sendMessage).toHaveBeenCalledWith(1, {
        type: 'ctrPlan',
        steps: [{ kind: 'scroll', ref: 'page', direction: 'down', pixels: 800, behavior: undefined }],
      });
    });

    it('tab_scroll page mode defaults the distance and accepts ref "page" equivalently', async () => {
      await mintActGrant();
      mock.tabs.sendMessage.mockResolvedValueOnce({ ok: true, result: SCROLL_RECEIPT });
      const promise = handleToolCall(call('tab_scroll', { ref: 'page', direction: 'up' }));
      await vi.waitFor(() => expect(getPendingApproval()).not.toBeNull());
      expect(getPendingApproval()!.steps[0]!.target).toBe('page up 800px');
      decideApproval(getPendingApproval()!.opId, true);
      expect((await promise).ok).toBe(true);
    });

    it('tab_scroll page mode without direction fails before any tab contact', async () => {
      await mintActGrant();
      expectError(await handleToolCall(call('tab_scroll', {})), 'invalid_target');
      expect(mock.tabs.sendMessage).not.toHaveBeenCalled();
      expect(getPendingApproval()).toBeNull();
    });

    it('tab_scroll rejects a bad pixels range and behavior before any tab contact', async () => {
      await mintActGrant();
      expectError(await handleToolCall(call('tab_scroll', { direction: 'down', pixels: 0 })), 'invalid_target');
      expectError(
        await handleToolCall(call('tab_scroll', { direction: 'down', pixels: 10001 })),
        'invalid_target',
      );
      expectError(
        await handleToolCall(call('tab_scroll', { direction: 'down', behavior: 'smooth' })),
        'invalid_target',
      );
      expect(mock.tabs.sendMessage).not.toHaveBeenCalled();
    });

    it('tab_scroll on an observe-only grant yields observe_only before any tab contact', async () => {
      await mintGrant(1, ORIGIN);
      mock.tabs.get.mockResolvedValue({ id: 1, url: `${ORIGIN}/` });
      expectError(await handleToolCall(call('tab_scroll', { direction: 'down' })), 'observe_only');
      expect(mock.tabs.sendMessage).not.toHaveBeenCalled();
    });

    it('tab_scroll element mode describes the ref and fails stale BEFORE approval', async () => {
      await mintActGrant();
      mock.tabs.sendMessage.mockResolvedValueOnce({
        ok: false,
        error: { code: 'stale_ref', message: 'Ref n42 is from an older snapshot.' },
      });
      expectError(await handleToolCall(call('tab_scroll', { ref: 'n42' })), 'stale_ref');
      expect(getPendingApproval()).toBeNull();
      expect(mock.tabs.sendMessage).toHaveBeenCalledTimes(1);
      expect(mock.tabs.sendMessage).toHaveBeenCalledWith(1, { type: 'ctrDescribe', ref: 'n42' });
    });

    it('tab_scroll element mode: approved plan carries ref only, with the described target', async () => {
      await mintActGrant();
      mock.tabs.sendMessage
        .mockResolvedValueOnce({ ok: true, result: { target: 'article "Post"' } }) // ctrDescribe
        .mockResolvedValueOnce({
          ok: true,
          result: {
            executed: [
              {
                action: 'scroll',
                ref: 'n42',
                target: 'article "Post"',
                scrollMetrics: { scrollTop: 4100, scrollHeight: 5000, clientHeight: 900, atBottom: true },
              },
            ],
            pageState: 'settled',
          },
        });
      const promise = handleToolCall(call('tab_scroll', { ref: 'n42' }));
      await vi.waitFor(() => expect(getPendingApproval()).not.toBeNull());
      // The card describes what actually happens: scrollIntoView, not a distance.
      expect(getPendingApproval()!.steps).toEqual([
        { kind: 'scroll', target: 'article "Post"', detail: 'scroll into view (centre of the viewport)' },
      ]);
      decideApproval(getPendingApproval()!.opId, true);
      const res = await promise;
      expect(res.ok).toBe(true);
      expect(mock.tabs.sendMessage).toHaveBeenLastCalledWith(1, {
        type: 'ctrPlan',
        steps: [{ kind: 'scroll', ref: 'n42' }],
      });
    });

    it('tab_scroll rejects pixels and direction in element mode instead of ignoring them', async () => {
      // F-A2: a parameter that is accepted, shown, and then dropped is a contract
      // failure — the agent would believe it asked for a bounded move.
      await mintActGrant();
      mock.tabs.sendMessage = vi.fn(async () => ({ ok: true, result: {} }));
      expectError(await handleToolCall(call('tab_scroll', { ref: 'n42', pixels: 300 })), 'invalid_target');
      expectError(await handleToolCall(call('tab_scroll', { ref: 'n42', direction: 'up' })), 'invalid_target');
      expectError(await handleToolCall(call('tab_scroll', { ref: 'n42', behavior: 'auto' })), 'invalid_target');
      expect(mock.tabs.sendMessage).not.toHaveBeenCalled();
    });

    it('tab_scroll rejects a malformed ref before any tab contact', async () => {
      await mintActGrant();
      expectError(await handleToolCall(call('tab_scroll', { ref: '#feed' })), 'unknown_ref');
      expect(mock.tabs.sendMessage).not.toHaveBeenCalled();
    });

    it('tab_plan accepts a page-scroll step alongside a click and rejects page mode without direction', async () => {
      await mintActGrant();
      mock.tabs.sendMessage
        .mockResolvedValueOnce({ ok: true, result: { target: 'button "Save"' } }) // describe click step
        .mockResolvedValueOnce({ ok: true, result: { executed: [], pageState: 'settled' } });
      const steps = [
        { kind: 'scroll', ref: 'page', direction: 'down' },
        { kind: 'click', ref: 'n7' },
      ];
      const promise = handleToolCall(call('tab_plan', { steps }));
      await vi.waitFor(() => expect(getPendingApproval()).not.toBeNull());
      expect(getPendingApproval()!.steps).toEqual([
        { kind: 'scroll', target: 'page down 800px', detail: 'down 800px (page scroller or inner feed container)' },
        { kind: 'click', target: 'button "Save"', detail: undefined },
      ]);
      decideApproval(getPendingApproval()!.opId, true);
      expect((await promise).ok).toBe(true);

      expectError(
        await handleToolCall(call('tab_plan', { steps: [{ kind: 'scroll', ref: 'page' }] })),
        'invalid_target',
      );
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

  describe('tab_navigate (C-12)', () => {
    const ORIGIN = 'https://docs.example.com';
    const NAV_DEST = 'https://docs.example.com/new-page';
    const CROSS_DEST = 'https://other.example.com/page';

    /** Fresh act+allowNavigate grant on tab 1. */
    function mintNav() {
      return mintGrant(1, ORIGIN, Date.now(), 'act', false, true);
    }

    function mockTab(url = ORIGIN + '/') {
      mock.tabs.get.mockResolvedValue({ id: 1, url });
    }

    /** Emit a load-complete event (optionally with the observed URL). */
    function simulateLoadComplete(url?: string) {
      mock.tabs.onUpdated.emit(1, url ? { status: 'complete', url } : { status: 'complete' });
    }

    /**
     * Fake-timer helper: flush the async pre-dispatch chain (storage reads,
     * tabs.update) without advancing the clock, then advance past the named
     * millisecond mark. Mirrors the precedent in approvals.test.ts:49-51.
     */
    async function flushAndAdvance(ms: number) {
      await vi.advanceTimersByTimeAsync(0);
      vi.advanceTimersByTime(ms);
    }

    // ── Capability gate ────────────────────────────────────────────────
    it('navigate_not_allowed when the flag is off (act grant, no allowNavigate)', async () => {
      void (await mintGrant(1, ORIGIN, Date.now(), 'act'));
      mockTab();
      const res = await handleToolCall(call('tab_navigate', { url: NAV_DEST }));
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.error.code).toBe('navigate_not_allowed');
      expect(mock.tabs.update).not.toHaveBeenCalled();
    });

    it('observe_only for observe-mode grant even with allowNavigate on', async () => {
      void (await mintGrant(1, ORIGIN, Date.now(), 'observe', false, true));
      mockTab();
      const res = await handleToolCall(call('tab_navigate', { url: NAV_DEST }));
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.error.code).toBe('observe_only');
    });

    // ── §3.1 URL validation ────────────────────────────────────────────
    it('navigate_bad_url: rejected schemes', async () => {
      void (await mintNav());
      mockTab();
      for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'about:blank']) {
        const res = await handleToolCall(call('tab_navigate', { url: bad }));
        expect(res.ok).toBe(false);
        if (!res.ok) expect(res.error.code).toBe('navigate_bad_url');
      }
      expect(mock.tabs.update).not.toHaveBeenCalled();
    });

    it('navigate_bad_url: embedded credentials rejected', async () => {
      void (await mintNav());
      mockTab();
      const res = await handleToolCall(call('tab_navigate', { url: 'https://user:pass@example.com/' }));
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.error.code).toBe('navigate_bad_url');
    });

    it('navigate_bad_url: fragment-only navigation rejected', async () => {
      void (await mintNav());
      mockTab();
      const res = await handleToolCall(call('tab_navigate', { url: '#section' }));
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.error.code).toBe('navigate_bad_url');
    });

    it('navigate_bad_url: absolute fragment-only URL to the current page rejected', async () => {
      void (await mintNav());
      mockTab(ORIGIN + '/');
      const res = await handleToolCall(call('tab_navigate', { url: ORIGIN + '/#other-anchor' }));
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.error.code).toBe('navigate_bad_url');
      expect(res.error.message).toContain('Fragment-only');
      expect(mock.tabs.update).not.toHaveBeenCalled();
    });

    it('navigate_bad_url: unparseable string rejected', async () => {
      void (await mintNav());
      mockTab();
      const res = await handleToolCall(call('tab_navigate', { url: 'not a url at all' }));
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.error.code).toBe('navigate_bad_url');
    });

    it('navigate_bad_url: URL above the 2048-char limit rejected', async () => {
      void (await mintNav());
      mockTab();
      const long = 'https://example.com/' + 'a'.repeat(2100);
      const res = await handleToolCall(call('tab_navigate', { url: long }));
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.error.code).toBe('navigate_bad_url');
      expect(res.error.message).toContain('2048');
    });

    it('navigate_bad_url: backslash / control char pre-checks', async () => {
      void (await mintNav());
      mockTab();
      const withBackslash = await handleToolCall(call('tab_navigate', { url: 'https://example.com/\\evil' }));
      expect(withBackslash.ok).toBe(false);
      if (!withBackslash.ok) expect(withBackslash.error.code).toBe('navigate_bad_url');
      const withControl = await handleToolCall(call('tab_navigate', { url: 'https://example.com/\u0000evil' }));
      expect(withControl.ok).toBe(false);
      if (!withControl.ok) expect(withControl.error.code).toBe('navigate_bad_url');
    });

    // ── URL normalization battery (spec §6) ────────────────────────────
    it('URL normalization battery: case, IPv6, trailing slash, %2F, empty-userinfo', async () => {
      void (await mintNav());
      mockTab();
      // Every URL below is a valid http(s) URL that must PASS validation
      // (i.e. NOT rejected as navigate_bad_url). Host case, trailing slash,
      // encoded slash, and empty userinfo all normalize to a parseable origin.
      const battery = [
        'https://DOCS.example.com/page', // host case → normalizes to docs.example.com (same-origin)
        'https://docs.example.com/', // trailing slash
        'https://docs.example.com/a%2Fb/c', // %2F in the path (encoded slash)
        'https://@docs.example.com/page', // empty userinfo
      ];
      for (const url of battery) {
        mock.tabs.update.mockClear();
        mock.tabs.update.mockImplementation(async () => {
          simulateLoadComplete(url);
          return { id: 1, url };
        });
        const res = await handleToolCall(call('tab_navigate', { url }));
        // Not a validation rejection:
        if (!res.ok) {
          expect(res.error.code).not.toBe('navigate_bad_url');
        } else {
          // These are same-origin → no approval, dispatched.
          expect(res.result).toBeTruthy();
        }
      }
      // IPv6: the origin is a different host → cross-origin → reaches approval.
      mock.tabs.update.mockClear();
      mock.tabs.update.mockResolvedValue({ id: 1, url: 'https://[::1]:8443/x' });
      const ip6 = handleToolCall(call('tab_navigate', { url: 'https://[::1]:8443/x' }));
      await vi.waitFor(() => expect(getPendingApproval()).not.toBeNull());
      expect(getPendingApproval()!.steps[0]?.kind).toBe('navigate');
      decideApproval(getPendingApproval()!.opId, false);
      await ip6;
    });

    it('URL normalization: explicit default port is same-origin (no approval)', async () => {
      void (await mintNav());
      mockTab();
      mock.tabs.update.mockImplementation(async () => {
        simulateLoadComplete('https://docs.example.com:443/page');
        return { id: 1, url: 'https://docs.example.com:443/page' };
      });
      const promise = handleToolCall(call('tab_navigate', { url: 'https://docs.example.com:443/page' }));
      await new Promise((r) => setTimeout(r, 50));
      expect(getPendingApproval()).toBeNull();
      const res = await promise;
      expect(res.ok).toBe(true);
    });

    it('URL normalization: explicit non-default port is cross-origin (approval)', async () => {
      void (await mintNav());
      mockTab();
      mock.tabs.update.mockResolvedValue({ id: 1, url: 'https://docs.example.com:8443/x' });
      const promise = handleToolCall(call('tab_navigate', { url: 'https://docs.example.com:8443/x' }));
      await vi.waitFor(() => expect(getPendingApproval()).not.toBeNull());
      expect(getPendingApproval()!.steps[0]?.kind).toBe('navigate');
      decideApproval(getPendingApproval()!.opId, false);
      await promise;
    });

    // ── Two-tier: cross-origin NO LONGER rejected → reaches approval ──
    it('cross-origin is not rejected up-front: it reaches the approval card', async () => {
      void (await mintNav());
      mockTab();
      mock.tabs.update.mockResolvedValue(undefined);
      const promise = handleToolCall(call('tab_navigate', { url: CROSS_DEST }));
      await vi.waitFor(() => expect(getPendingApproval()).not.toBeNull());
      const card = getPendingApproval()!;
      expect(card.steps[0]?.kind).toBe('navigate');
      expect(card.steps[0]?.target).toContain(CROSS_DEST);
      expect(card.steps[0]?.detail).toContain('DIFFERENT origin');
      decideApproval(card.opId, false);
      await promise;
    });

    // ── Same-origin success (no card, either tier) ─────────────────────
    it('same-origin: no approval, complete, grant stays active', async () => {
      void (await mintNav());
      mockTab();
      mock.tabs.update.mockImplementation(async () => {
        simulateLoadComplete(NAV_DEST);
        return { id: 1, url: NAV_DEST };
      });
      const promise = handleToolCall(call('tab_navigate', { url: NAV_DEST }));
      await new Promise((r) => setTimeout(r, 50));
      expect(getPendingApproval()).toBeNull();
      const res = await promise;
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      const result = res.result as { requestedUrl: string; finalUrl: string; loadState: string; grantStatus: string };
      expect(result.requestedUrl).toBe(NAV_DEST);
      expect(result.finalUrl).toBe(NAV_DEST);
      expect(result.loadState).toBe('complete');
      expect(result.grantStatus).toBe('active');
      expect(mock.tabs.update).toHaveBeenCalledWith(1, { url: NAV_DEST });
    });

    it('Freaky-on + same-origin → no card, audits action_auto_approved + navigate_dispatched', async () => {
      const grant = await mintNav();
      await setAutoApprove(grant.grantId, true);
      mockTab();
      mock.tabs.update.mockImplementation(async () => {
        simulateLoadComplete(NAV_DEST);
        return { id: 1, url: NAV_DEST };
      });
      const res = await handleToolCall(call('tab_navigate', { url: NAV_DEST }));
      expect(res.ok).toBe(true);
      expect(getPendingApproval()).toBeNull();
      const types = (await getAudit()).map((e) => e.type);
      expect(types).toContain('action_auto_approved');
      expect(types).toContain('navigate_dispatched');
      expect(types).toContain('navigate_completed');
      // Navigate events carry grantId (F2 forensic join).
      const navEvents = (await getAudit()).filter((e) => e.type === 'navigate_dispatched');
      expect(navEvents[0]?.grantId).toBe(grant.grantId);
    });

    it('Freaky-on + cross-origin → card STILL appears (v3 guard)', async () => {
      const grant = await mintNav();
      await setAutoApprove(grant.grantId, true); // Freaky is on
      mockTab();
      mock.tabs.update.mockResolvedValue(undefined);
      const promise = handleToolCall(call('tab_navigate', { url: CROSS_DEST }));
      await vi.waitFor(() => expect(getPendingApproval()).not.toBeNull());
      // The v3 guard: Freaky does NOT bypass a cross-origin boundary card.
      expect(getPendingApproval()).not.toBeNull();
      decideApproval(getPendingApproval()!.opId, false);
      await promise;
    });

    // ── Cross-origin success → suspended receipt ───────────────────────
    it('cross-origin: approve → dispatch, receipt shows suspended + new origin', async () => {
      void (await mintNav());
      mockTab();
      mock.tabs.update.mockImplementation(async () => {
        simulateLoadComplete(CROSS_DEST);
        return { id: 1, url: CROSS_DEST };
      });
      // After the load, the tab is at CROSS_DEST; post-load revalidation sees
      // the origin changed → suspends the grant. Pre-load calls (routeToolCall,
      // post-approval revalidation, pre-dispatch revalidation) all see ORIGIN.
      let getCall = 0;
      mock.tabs.get.mockImplementation(async () => {
        getCall += 1;
        if (getCall <= 3) return { id: 1, url: ORIGIN + '/' };
        return { id: 1, url: CROSS_DEST };
      });
      const promise = handleToolCall(call('tab_navigate', { url: CROSS_DEST }));
      await vi.waitFor(() => expect(getPendingApproval()).not.toBeNull());
      decideApproval(getPendingApproval()!.opId, true);
      const res = await promise;
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      const result = res.result as { loadState: string; grantStatus: string; finalUrl: string };
      expect(result.loadState).toBe('complete');
      expect(result.grantStatus).toBe('suspended');
      expect(result.finalUrl).toBe(CROSS_DEST);
    });

    it('cross-origin: deny → approval_denied, tab never updated', async () => {
      void (await mintNav());
      mockTab();
      const promise = handleToolCall(call('tab_navigate', { url: CROSS_DEST }));
      await vi.waitFor(() => expect(getPendingApproval()).not.toBeNull());
      decideApproval(getPendingApproval()!.opId, false);
      const res = await promise;
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.error.code).toBe('approval_denied');
      expect(mock.tabs.update).not.toHaveBeenCalled();
    });

    it('redirect chain: requested B, lands C → receipt shows finalUrl C', async () => {
      void (await mintNav());
      mockTab();
      mock.tabs.update.mockImplementation(async () => {
        simulateLoadComplete('https://docs.example.com/final');
        return { id: 1, url: 'https://docs.example.com/final' };
      });
      const promise = handleToolCall(call('tab_navigate', { url: NAV_DEST }));
      await new Promise((r) => setTimeout(r, 50));
      const res = await promise;
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      const result = res.result as { requestedUrl: string; finalUrl: string; loadState: string };
      expect(result.requestedUrl).toBe(NAV_DEST);
      expect(result.finalUrl).toBe('https://docs.example.com/final');
      expect(result.loadState).toBe('complete');
    });

    it('same-origin dispatch whose redirect lands off-origin → suspended', async () => {
      // The agent requests a same-origin URL (so no approval card is shown),
      // but the page 301-redirects to a different origin. The post-load
      // revalidation sees the off-origin URL → suspends the grant. This is the
      // "off-origin redirect" path the origin pin exists to catch.
      void (await mintNav());
      mockTab();
      const OFF_ORIGIN = 'https://redirected.example.com/landed';
      mock.tabs.update.mockImplementation(async () => {
        // The redirect chain: the tab's final URL is off-origin.
        simulateLoadComplete(OFF_ORIGIN);
        return { id: 1, url: OFF_ORIGIN };
      });
      // Post-load: the tab now sits on the off-origin URL.
      let getCall = 0;
      mock.tabs.get.mockImplementation(async () => {
        getCall += 1;
        if (getCall <= 2) return { id: 1, url: ORIGIN + '/' };
        return { id: 1, url: OFF_ORIGIN };
      });
      const promise = handleToolCall(call('tab_navigate', { url: NAV_DEST }));
      await new Promise((r) => setTimeout(r, 50));
      // No approval was requested (same-origin request).
      expect(getPendingApproval()).toBeNull();
      const res = await promise;
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      const result = res.result as { loadState: string; grantStatus: string; finalUrl: string };
      expect(result.finalUrl).toBe(OFF_ORIGIN);
      expect(result.grantStatus).toBe('suspended');
      expect(result.loadState).toBe('complete');
    });

    // ── chrome-error final URL → suspended + error prose ───────────────
    it('chrome-error final URL → suspended receipt + error prose', async () => {
      void (await mintNav());
      mockTab();
      const ERROR_URL = 'chrome-error://chromewebdata/';
      mock.tabs.update.mockImplementation(async () => {
        simulateLoadComplete(ERROR_URL);
        return { id: 1, url: ERROR_URL };
      });
      // Post-load: the tab is on the chrome-error page (origin mismatch).
      let getCall = 0;
      mock.tabs.get.mockImplementation(async () => {
        getCall += 1;
        if (getCall <= 2) return { id: 1, url: ORIGIN + '/' };
        return { id: 1, url: ERROR_URL };
      });
      const res = await handleToolCall(call('tab_navigate', { url: NAV_DEST }));
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      const result = res.result as { loadState: string; grantStatus: string; finalUrl: string };
      expect(result.grantStatus).toBe('suspended');
      expect(result.finalUrl).toBe(ERROR_URL);
      expect(result.loadState).toBe('complete');
    });

    // ── load-wait timeout (fake timers) + cleanup invariant ────────────
    it('30 s load-wait timeout → loadState timeout, no retry, cleanup invariant holds', async () => {
      vi.useFakeTimers();
      try {
        void (await mintNav());
        mockTab();
        mock.tabs.update.mockResolvedValue({ id: 1, url: NAV_DEST });
        // No onUpdated complete event ever fires → the 30 s timeout wins.
        const promise = handleToolCall(call('tab_navigate', { url: NAV_DEST }));
        await flushAndAdvance(30_001);
        const res = await promise;
        expect(res.ok).toBe(true);
        if (!res.ok) return;
        const result = res.result as { loadState: string };
        expect(result.loadState).toBe('timeout');
        // No retry: tabs.update was called exactly once.
        expect(mock.tabs.update).toHaveBeenCalledTimes(1);
        // Cleanup invariant: the onUpdated listener was removed (no dangling
        // listener that could fire on the user's NEXT navigation).
        expect(mock.tabs.onUpdated.hasListener(expect.any(Function))).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    }, 10_000);

    it('cleanup invariant: complete event also removes the listener + timer', async () => {
      vi.useFakeTimers();
      try {
        void (await mintNav());
        mockTab();
        mock.tabs.update.mockImplementation(async () => {
          simulateLoadComplete(NAV_DEST);
          return { id: 1, url: NAV_DEST };
        });
        const promise = handleToolCall(call('tab_navigate', { url: NAV_DEST }));
        await vi.advanceTimersByTimeAsync(0);
        const res = await promise;
        expect(res.ok).toBe(true);
        if (res.ok) expect((res.result as { loadState: string }).loadState).toBe('complete');
        expect(mock.tabs.onUpdated.hasListener(expect.any(Function))).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    }, 10_000);

    // ── tab closed mid-wait → grant_revoked ────────────────────────────
    it('tab closed mid-wait → grant_revoked (post-load re-validation finds no tab)', async () => {
      vi.useFakeTimers();
      try {
        void (await mintNav());
        mockTab();
        mock.tabs.update.mockResolvedValue({ id: 1, url: NAV_DEST });
        // Pre-dispatch calls (routeToolCall + preDispatch) succeed; the
        // post-load revalidation (call 3+) finds the tab gone → grant_revoked.
        let getCall = 0;
        mock.tabs.get.mockImplementation(async () => {
          getCall += 1;
          if (getCall <= 2) return { id: 1, url: ORIGIN + '/' };
          throw new Error('No tab with given id.');
        });
        const promise = handleToolCall(call('tab_navigate', { url: NAV_DEST }));
        await flushAndAdvance(30_001); // load-wait times out
        const res = await promise;
        expect(res.ok).toBe(false);
        if (res.ok) return;
        expect(res.error.code).toBe('grant_revoked');
        expect(mock.tabs.onUpdated.hasListener(expect.any(Function))).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    }, 10_000);

    // ── grant expired / suspended mid-wait ─────────────────────────────
    it('grant expired mid-wait → re-validation fails closed (grant_expired)', async () => {
      // Mint a grant that expires ~immediately (past its 30-min TTL).
      void (await mintGrant(1, ORIGIN, Date.now() - 30 * 60 * 1000 - 1_000, 'act', false, true));
      mockTab();
      mock.tabs.update.mockResolvedValue({ id: 1, url: NAV_DEST });
      const res = await handleToolCall(call('tab_navigate', { url: NAV_DEST }));
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.error.code).toBe('grant_expired');
      expect(mock.tabs.update).not.toHaveBeenCalled();
    });

    it('grant suspended mid-approval → re-validation fails closed (grant_suspended)', async () => {
      const grant = await mintNav();
      mockTab();
      mock.tabs.update.mockResolvedValue(undefined);
      const promise = handleToolCall(call('tab_navigate', { url: CROSS_DEST }));
      await vi.waitFor(() => expect(getPendingApproval()).not.toBeNull());
      // User suspends the grant while the approval card is up.
      await suspendGrant(grant.grantId);
      decideApproval(getPendingApproval()!.opId, true);
      const res = await promise;
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.error.code).toBe('grant_suspended');
      expect(mock.tabs.update).not.toHaveBeenCalled();
    });

    // ── conflict attribution (user nav during wait) ────────────────────
    it('conflict: user navigated during the wait → loadState conflict (same-origin grant)', async () => {
      void (await mintNav());
      mockTab();
      const USER_NAV_URL = 'https://docs.example.com/user-navigated';
      // Our dispatch completes, but the observed final URL is the user's
      // navigation, which was never the requested URL and never observed as a
      // changeInfo.url during our wait.
      mock.tabs.update.mockImplementation(async () => {
        // Complete with NO url (the URL was set by tabs.update, not a redirect),
        // so wait.finalUrl is undefined → the post-load tabs.get fallback runs.
        simulateLoadComplete(undefined);
        return { id: 1, url: NAV_DEST };
      });
      let getCall = 0;
      mock.tabs.get.mockImplementation(async () => {
        getCall += 1;
        if (getCall <= 2) return { id: 1, url: ORIGIN + '/' };
        // Post-load: the user has navigated to a different same-origin page.
        return { id: 1, url: USER_NAV_URL };
      });
      const res = await handleToolCall(call('tab_navigate', { url: NAV_DEST }));
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      const result = res.result as { loadState: string; grantStatus: string; finalUrl: string };
      expect(result.finalUrl).toBe(USER_NAV_URL);
      expect(result.loadState).toBe('conflict');
      expect(result.grantStatus).toBe('active'); // same-origin: grant untouched
    });

    it('conflict + suspended receipt (F7): user navigated to another origin during the wait', async () => {
      void (await mintNav());
      mockTab();
      const USER_NAV_URL = 'https://user-origin.example/other';
      mock.tabs.update.mockImplementation(async () => {
        simulateLoadComplete(undefined);
        return { id: 1, url: NAV_DEST };
      });
      let getCall = 0;
      mock.tabs.get.mockImplementation(async () => {
        getCall += 1;
        if (getCall <= 2) return { id: 1, url: ORIGIN + '/' };
        return { id: 1, url: USER_NAV_URL };
      });
      const res = await handleToolCall(call('tab_navigate', { url: NAV_DEST }));
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      const result = res.result as { loadState: string; grantStatus: string; finalUrl: string };
      expect(result.finalUrl).toBe(USER_NAV_URL);
      expect(result.loadState).toBe('conflict');
      // The final URL is off-origin → the grant is suspended (F7 receipt shape).
      expect(result.grantStatus).toBe('suspended');
    });

    // ── busy: parallel Freaky navigates AND approval-pending ───────────
    it('busy: a second same-origin navigate while the first is in flight', async () => {
      vi.useFakeTimers();
      try {
        void (await mintNav());
        mockTab();
        // First navigate: dispatch succeeds, but the load never completes →
        // it stays in flight (30 s load-wait).
        mock.tabs.update.mockResolvedValue({ id: 1, url: NAV_DEST });
        const first = handleToolCall(call('tab_navigate', { url: NAV_DEST }));
        // Flush the pre-dispatch chain (storage reads, tabs.update) without
        // advancing the clock, so the first navigate is in flight.
        await vi.advanceTimersByTimeAsync(0);
        // Second navigate (same grant): must be rejected as busy.
        const second = await handleToolCall(call('tab_navigate', { url: NAV_DEST }));
        expect(second.ok).toBe(false);
        if (second.ok) return;
        expect(second.error.code).toBe('busy');
        expect(mock.tabs.update).toHaveBeenCalledTimes(1);
        // Let the first one finish (load-wait timeout) to drain the in-flight set.
        vi.advanceTimersByTime(30_001);
        await first;
      } finally {
        vi.useRealTimers();
      }
    }, 10_000);

    it('busy: a cross-origin navigate while another approval is pending', async () => {
      void (await mintNav());
      mockTab();
      mock.tabs.update.mockResolvedValue(undefined);
      // First cross-origin navigate: an approval card is pending.
      const first = handleToolCall(call('tab_navigate', { url: CROSS_DEST }));
      await vi.waitFor(() => expect(getPendingApproval()).not.toBeNull());
      // Second cross-origin navigate: the approval gate is one-at-a-time → busy.
      const second = await handleToolCall(call('tab_navigate', { url: CROSS_DEST }));
      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.error.code).toBe('busy');
      // Resolve the first.
      decideApproval(getPendingApproval()!.opId, false);
      await first;
    }, 10_000);

    // ── action_timeout audit path (110 s fake timers) ──────────────────
    it('cross-origin approval times out (110 s) → approval_timeout + action_timeout audit', async () => {
      vi.useFakeTimers();
      try {
        void (await mintNav());
        mockTab();
        mock.tabs.update.mockResolvedValue(undefined);
        const promise = handleToolCall(call('tab_navigate', { url: CROSS_DEST }));
        await vi.advanceTimersByTimeAsync(0);
        expect(getPendingApproval()).not.toBeNull();
        // Advance past the 110 s approval window.
        vi.advanceTimersByTime(110_001);
        const res = await promise;
        expect(res.ok).toBe(false);
        if (res.ok) return;
        expect(res.error.code).toBe('approval_timeout');
        expect(mock.tabs.update).not.toHaveBeenCalled();
        const types = (await getAudit()).map((e) => e.type);
        expect(types).toContain('action_timeout');
        expect(types).toContain('action_proposed');
      } finally {
        vi.useRealTimers();
      }
    }, 10_000);
  });
});
