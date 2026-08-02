import { beforeEach, describe, expect, it } from 'vitest';
import type { ToolCallRequest } from '@ctr/shared';
import { installChromeMock, type ChromeMock } from './chrome-mock.js';
import { getGrant, listGrants, mintGrant, suspendGrant } from '../src/background/grant-store.js';
import { getAudit } from '../src/background/audit.js';
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
      ok: true,
    });
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
});
