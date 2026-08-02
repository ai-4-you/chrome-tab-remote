import { describe, expect, it } from 'vitest';
import {
  AuditEntrySchema,
  AuditEventSchema,
  ERROR_CODES,
  ErrorCodeSchema,
  GrantsChangedSchema,
  NativeMessageSchema,
  TOOL_NAMES,
  ToolCallRequestSchema,
  ToolResultSchema,
  type Grant,
} from '@ctr/shared';

const grant: Grant = {
  grantId: '4b1c9c1e-8f2a-4f0e-9b1a-2c3d4e5f6a7b',
  tabId: 123,
  origin: 'https://app.example.com',
  mode: 'observe',
  status: 'active',
  expiresAt: '2026-08-02T12:30:00.000Z',
  createdByGesture: true,
};

describe('TOOL_NAMES / ERROR_CODES', () => {
  it('exposes exactly the Stage 1 tools', () => {
    expect(TOOL_NAMES).toEqual(['tab_snapshot', 'tab_read', 'list_grants']);
  });

  it('exposes the agreed error codes', () => {
    expect(ERROR_CODES).toEqual([
      'no_grant',
      'grant_expired',
      'grant_suspended',
      'grant_revoked',
      'unknown_ref',
      'tab_unreachable',
      'timeout',
    ]);
  });

  it('rejects unknown error codes', () => {
    expect(ErrorCodeSchema.safeParse('nope').success).toBe(false);
  });
});

describe('ToolCallRequestSchema', () => {
  it.each(TOOL_NAMES)('accepts tool %s', (tool) => {
    const msg = { id: 'req-1', kind: 'toolCall', tool, params: {} };
    expect(ToolCallRequestSchema.safeParse(msg).success).toBe(true);
  });

  it('accepts arbitrary params object', () => {
    const msg = {
      id: 'req-2',
      kind: 'toolCall',
      tool: 'tab_read',
      params: { grantId: grant.grantId, ref: 'n42' },
    };
    expect(ToolCallRequestSchema.parse(msg)).toEqual(msg);
  });

  it('rejects an unknown tool', () => {
    const msg = { id: 'req-3', kind: 'toolCall', tool: 'tab_click', params: {} };
    expect(ToolCallRequestSchema.safeParse(msg).success).toBe(false);
  });

  it('rejects an empty id', () => {
    const msg = { id: '', kind: 'toolCall', tool: 'tab_snapshot', params: {} };
    expect(ToolCallRequestSchema.safeParse(msg).success).toBe(false);
  });

  it('rejects a missing params object', () => {
    const msg = { id: 'req-4', kind: 'toolCall', tool: 'tab_snapshot' };
    expect(ToolCallRequestSchema.safeParse(msg).success).toBe(false);
  });
});

describe('ToolResultSchema', () => {
  it('accepts an ok result', () => {
    const msg = { id: 'req-1', kind: 'toolResult', ok: true, result: { grants: [] } };
    expect(ToolResultSchema.safeParse(msg).success).toBe(true);
  });

  it('accepts an error result with a known code', () => {
    const msg = {
      id: 'req-1',
      kind: 'toolResult',
      ok: false,
      error: { code: 'no_grant', message: 'unknown grantId' },
    };
    expect(ToolResultSchema.safeParse(msg).success).toBe(true);
  });

  it('rejects ok:false without error', () => {
    const msg = { id: 'req-1', kind: 'toolResult', ok: false };
    expect(ToolResultSchema.safeParse(msg).success).toBe(false);
  });

  it('rejects an unknown error code', () => {
    const msg = {
      id: 'req-1',
      kind: 'toolResult',
      ok: false,
      error: { code: 'boom', message: 'x' },
    };
    expect(ToolResultSchema.safeParse(msg).success).toBe(false);
  });
});

describe('GrantsChangedSchema', () => {
  it('accepts an empty grant list', () => {
    expect(GrantsChangedSchema.safeParse({ kind: 'grantsChanged', grants: [] }).success).toBe(true);
  });

  it('accepts a list with one valid grant', () => {
    const msg = { kind: 'grantsChanged', grants: [grant] };
    expect(GrantsChangedSchema.parse(msg)).toEqual(msg);
  });

  it('rejects invalid grants in the list', () => {
    const msg = { kind: 'grantsChanged', grants: [{ ...grant, mode: 'act' }] };
    expect(GrantsChangedSchema.safeParse(msg).success).toBe(false);
  });
});

describe('AuditEntrySchema / AuditEventSchema', () => {
  const entry = {
    ts: 1754130000000,
    type: 'tool_call',
    grantId: grant.grantId,
    tool: 'tab_snapshot',
    ok: true,
    detail: 'captured 42 nodes',
  };

  it('accepts a full entry', () => {
    expect(AuditEntrySchema.parse(entry)).toEqual(entry);
  });

  it('accepts a minimal lifecycle entry', () => {
    expect(AuditEntrySchema.safeParse({ ts: 1, type: 'grant_revoked' }).success).toBe(true);
  });

  it('rejects a negative ts', () => {
    expect(AuditEntrySchema.safeParse({ ...entry, ts: -1 }).success).toBe(false);
  });

  it('rejects an empty type', () => {
    expect(AuditEntrySchema.safeParse({ ...entry, type: '' }).success).toBe(false);
  });

  it('wraps an entry as an audit event', () => {
    expect(AuditEventSchema.safeParse({ kind: 'audit', entry }).success).toBe(true);
  });
});

describe('NativeMessageSchema', () => {
  it('parses every message kind', () => {
    const messages = [
      { id: 'a', kind: 'toolCall', tool: 'tab_snapshot', params: {} },
      { id: 'a', kind: 'toolResult', ok: true, result: null },
      { id: 'a', kind: 'toolResult', ok: false, error: { code: 'timeout', message: 't' } },
      { kind: 'grantsChanged', grants: [grant] },
      { kind: 'audit', entry: { ts: 1, type: 'grant_created' } },
    ];
    for (const msg of messages) {
      expect(NativeMessageSchema.safeParse(msg).success).toBe(true);
    }
  });

  it('rejects an unknown kind', () => {
    expect(NativeMessageSchema.safeParse({ kind: 'ping' }).success).toBe(false);
  });
});
