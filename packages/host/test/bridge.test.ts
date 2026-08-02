import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditEntry, Grant, ToolCallRequest } from '@ctr/shared';
import { Bridge, DEFAULT_TOOL_TIMEOUT_MS, ToolCallError } from '../src/bridge.js';

function makeGrant(overrides: Partial<Grant> = {}): Grant {
  return {
    grantId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    tabId: 7,
    origin: 'https://app.example.com',
    mode: 'observe',
    status: 'active',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    createdByGesture: true,
    ...overrides,
  };
}

describe('Bridge', () => {
  let sent: ToolCallRequest[];
  let auditEntries: AuditEntry[];
  let logs: string[];
  let bridge: Bridge;

  beforeEach(() => {
    sent = [];
    auditEntries = [];
    logs = [];
    bridge = new Bridge({
      send: (msg) => sent.push(msg),
      auditSink: (entry) => auditEntries.push(entry),
      log: (line) => logs.push(line),
    });
  });

  afterEach(() => {
    bridge.dispose();
    vi.useRealTimers();
  });

  it('callTool sends a toolCall and resolves on the matching ok toolResult', async () => {
    const promise = bridge.callTool('tab_snapshot', { grantId: 'g1' });
    expect(sent).toHaveLength(1);
    const request = sent[0]!;
    expect(request).toMatchObject({ kind: 'toolCall', tool: 'tab_snapshot', params: { grantId: 'g1' } });

    bridge.handleMessage({ id: request.id, kind: 'toolResult', ok: true, result: { title: 'Hi' } });
    await expect(promise).resolves.toEqual({ title: 'Hi' });
    expect(bridge.pendingCount).toBe(0);
  });

  it('rejects with ToolCallError carrying the extension error code', async () => {
    const promise = bridge.callTool('tab_read', { grantId: 'g1', ref: 'n1' });
    const request = sent[0]!;
    bridge.handleMessage({
      id: request.id,
      kind: 'toolResult',
      ok: false,
      error: { code: 'unknown_ref', message: 'no element for ref n1' },
    });
    await expect(promise).rejects.toMatchObject({ name: 'ToolCallError', code: 'unknown_ref' });
  });

  it('times out after 15s with code timeout', async () => {
    vi.useFakeTimers();
    const promise = bridge.callTool('tab_snapshot', { grantId: 'g1' });
    const assertion = expect(promise).rejects.toMatchObject({ code: 'timeout' });
    vi.advanceTimersByTime(DEFAULT_TOOL_TIMEOUT_MS);
    await assertion;
    expect(bridge.pendingCount).toBe(0);
  });

  it('does not time out before the deadline', async () => {
    vi.useFakeTimers();
    const promise = bridge.callTool('tab_snapshot', { grantId: 'g1' });
    vi.advanceTimersByTime(DEFAULT_TOOL_TIMEOUT_MS - 1);
    bridge.handleMessage({ id: sent[0]!.id, kind: 'toolResult', ok: true, result: 'late but fine' });
    await expect(promise).resolves.toBe('late but fine');
  });

  it('ignores toolResults with unknown ids (logged, no crash)', () => {
    bridge.handleMessage({ id: 'never-sent', kind: 'toolResult', ok: true, result: 1 });
    expect(logs.some((l) => l.includes('unknown id'))).toBe(true);
  });

  it('drops schema-invalid messages without crashing', () => {
    bridge.handleMessage({ kind: 'toolResult' }); // missing id/ok
    bridge.handleMessage('garbage');
    bridge.handleMessage(null);
    bridge.handleMessage({ kind: 'whatIsThis' });
    expect(logs.filter((l) => l.includes('invalid native message'))).toHaveLength(4);
  });

  it('grantsChanged replaces the grant list and getGrants returns a copy', () => {
    const grant = makeGrant();
    bridge.handleMessage({ kind: 'grantsChanged', grants: [grant] });
    const grants = bridge.getGrants();
    expect(grants).toEqual([grant]);
    grants.pop();
    expect(bridge.getGrants()).toEqual([grant]);

    bridge.handleMessage({ kind: 'grantsChanged', grants: [] });
    expect(bridge.getGrants()).toEqual([]);
  });

  it('forwards audit events to the sink', () => {
    const entry: AuditEntry = { ts: 123, type: 'grant_created', grantId: 'g1' };
    bridge.handleMessage({ kind: 'audit', entry });
    expect(auditEntries).toEqual([entry]);
  });

  it('survives an audit sink that throws', () => {
    const throwing = new Bridge({
      send: () => {},
      auditSink: () => {
        throw new Error('disk full');
      },
      log: (line) => logs.push(line),
    });
    expect(() => throwing.handleMessage({ kind: 'audit', entry: { ts: 1, type: 'x' } })).not.toThrow();
    expect(logs.some((l) => l.includes('audit sink failed'))).toBe(true);
  });

  it('drops an unexpected inbound toolCall message', () => {
    bridge.handleMessage({ id: 'x1', kind: 'toolCall', tool: 'tab_snapshot', params: {} });
    expect(logs.some((l) => l.includes('unexpected toolCall'))).toBe(true);
  });

  it('rejects immediately with tab_unreachable when send throws', async () => {
    const broken = new Bridge({
      send: () => {
        throw new Error('pipe closed');
      },
    });
    await expect(broken.callTool('tab_snapshot', {})).rejects.toMatchObject({ code: 'tab_unreachable' });
  });

  it('dispose rejects all pending calls with tab_unreachable', async () => {
    const p1 = bridge.callTool('tab_snapshot', {});
    const p2 = bridge.callTool('tab_read', { ref: 'n1' });
    bridge.dispose();
    await expect(p1).rejects.toBeInstanceOf(ToolCallError);
    await expect(p2).rejects.toMatchObject({ code: 'tab_unreachable' });
    expect(bridge.pendingCount).toBe(0);
  });
});
