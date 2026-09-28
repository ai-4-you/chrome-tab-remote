import { describe, expect, it } from 'vitest';
import {
  AuditEntrySchema,
  AuditEventSchema,
  ERROR_CODES,
  ACT_TOOL_NAMES,
  isActTool,
  ErrorCodeSchema,
  GrantsChangedSchema,
  HostInfoSchema,
  NativeMessageSchema,
  TOOL_NAMES,
  PlanStepSchema,
  ActionResultSchema,
  SCROLL_DEFAULT_PIXELS,
  ToolCallRequestSchema,
  ToolResultSchema,
  type Grant,
} from '@ctr/shared';

const grant: Grant = {
  grantId: '4b1c9c1e-8f2a-4f0e-9b1a-2c3d4e5f6a7b',
  tabId: 123,
  origin: 'https://app.example.com',
  mode: 'observe',
  allowViewportScreenshot: false,
  status: 'active',
  expiresAt: '2026-08-02T12:30:00.000Z',
  createdByGesture: true,
};

describe('TOOL_NAMES / ERROR_CODES', () => {
  it('exposes exactly the Stage 1 + Stage 2 + scroll tools', () => {
    expect(TOOL_NAMES).toEqual([
      'tab_snapshot',
      'tab_read',
      'tab_read_many',
      'tab_find',
      'tab_screenshot_viewport',
      'list_grants',
      'request_grant',
      'tab_click',
      'tab_fill',
      'tab_select',
      'tab_scroll',
      'tab_plan',
    ]);
  });

  it('classifies tab_scroll as an act tool (grant mode + approval gate)', () => {
    expect(ACT_TOOL_NAMES).toContain('tab_scroll');
    expect(isActTool('tab_scroll')).toBe(true);
    expect(isActTool('tab_snapshot')).toBe(false);
  });

  it('exposes the agreed error codes', () => {
    expect(ERROR_CODES).toEqual([
      'no_grant',
      'grant_expired',
      'grant_suspended',
      'grant_revoked',
      'unknown_ref',
      'stale_ref',
      'invalid_target',
      'observe_only',
      'approval_denied',
      'approval_timeout',
      'busy',
      'tab_unreachable',
      'timeout',
      'screenshot_not_allowed',
      'tab_not_visible',
      'screenshot_too_large',
      'screenshot_capture_failed',
    ]);
  });

  it('rejects unknown error codes', () => {
    expect(ErrorCodeSchema.safeParse('nope').success).toBe(false);
  });
});

describe('PlanStepSchema / ActionResultSchema — scroll', () => {
  it('lists tab_scroll among the tools', () => {
    expect(TOOL_NAMES).toContain('tab_scroll');
  });

  it('accepts a page-mode scroll step with direction', () => {
    expect(
      PlanStepSchema.safeParse({ kind: 'scroll', ref: 'page', direction: 'down', pixels: 600 }).success,
    ).toBe(true);
  });

  it('rejects a page-mode scroll step without direction (superRefine)', () => {
    const parsed = PlanStepSchema.safeParse({ kind: 'scroll', ref: 'page' });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues[0]).toMatchObject({ path: ['direction'] });
  });

  it('accepts an element-mode scroll step with no direction', () => {
    expect(PlanStepSchema.safeParse({ kind: 'scroll', ref: 'n42' }).success).toBe(true);
  });

  it('rejects behavior on an element-mode scroll step (no settle to animate into)', () => {
    const b = PlanStepSchema.safeParse({ kind: 'scroll', ref: 'n42', behavior: 'auto' });
    expect(b.success).toBe(false);
    if (b.success) return;
    expect(b.error.issues[0]?.path).toEqual(['behavior']);
  });

  it('rejects direction and pixels on an element-mode scroll step (they would be ignored)', () => {
    // Element mode scrolls into view: a step carrying a distance would let the agent
    // believe it asked for a bounded move.
    const d = PlanStepSchema.safeParse({ kind: 'scroll', ref: 'n42', direction: 'down' });
    expect(d.success).toBe(false);
    if (d.success) return;
    expect(d.error.issues[0]?.path).toEqual(['direction']);

    const p = PlanStepSchema.safeParse({ kind: 'scroll', ref: 'n42', pixels: 300 });
    expect(p.success).toBe(false);
    if (p.success) return;
    expect(p.error.issues[0]?.path).toEqual(['pixels']);
  });

  it('rejects a non-instant/auto behavior on a scroll step', () => {
    expect(PlanStepSchema.safeParse({ kind: 'scroll', ref: 'page', direction: 'down', behavior: 'smooth' }).success).toBe(false);
  });

  it('keeps pageSettled an optional internal field on an action result', () => {
    expect(
      ActionResultSchema.safeParse({
        action: 'scroll',
        ref: 'page',
        target: 'the page',
        scrollMetrics: { scrollTop: 800, scrollHeight: 5000, clientHeight: 900, atBottom: false },
        pageSettled: false,
      }).success,
    ).toBe(true);
    expect(
      ActionResultSchema.safeParse({
        action: 'scroll',
        ref: 'page',
        target: 'the page',
        pageSettled: 'yes',
      }).success,
    ).toBe(false);
  });

  it('rejects out-of-range pixels and unknown behavior', () => {
    expect(
      PlanStepSchema.safeParse({ kind: 'scroll', ref: 'page', direction: 'up', pixels: 0 }).success,
    ).toBe(false);
    expect(
      PlanStepSchema.safeParse({ kind: 'scroll', ref: 'page', direction: 'up', pixels: 20000 }).success,
    ).toBe(false);
    expect(
      PlanStepSchema.safeParse({
        kind: 'scroll',
        ref: 'page',
        direction: 'up',
        behavior: 'smooth',
      }).success,
    ).toBe(false);
  });

  it('still rejects a non-ref, non-page ref for other kinds', () => {
    expect(PlanStepSchema.safeParse({ kind: 'click', ref: 'page' }).success).toBe(true); // schema-level;
    // enforcement for 'page' on click/fill/select happens pre-approval in the
    // content script (ctrDescribe answers unknown_ref), before any approval card.
    expect(PlanStepSchema.safeParse({ kind: 'click', ref: '#btn' }).success).toBe(false);
  });

  it('accepts a scroll action result with metrics and rejects a bad metric', () => {
    expect(
      ActionResultSchema.safeParse({
        action: 'scroll',
        ref: 'page',
        target: 'div.feed',
        scrollMetrics: { scrollTop: 800, scrollHeight: 5000, clientHeight: 900, atBottom: false },
      }).success,
    ).toBe(true);
    expect(
      ActionResultSchema.safeParse({
        action: 'scroll',
        ref: 'page',
        target: 'the page',
        scrollMetrics: { scrollTop: -1, scrollHeight: 5000, clientHeight: 900, atBottom: false },
      }).success,
    ).toBe(false);
  });

  it('documents the default page-mode distance', () => {
    expect(SCROLL_DEFAULT_PIXELS).toBe(800);
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
    const msg = { id: 'req-3', kind: 'toolCall', tool: 'tab_execute_js', params: {} };
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
    const msg = { kind: 'grantsChanged', grants: [{ ...grant, mode: 'admin' }] };
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

  it('accepts hostInfo announcements with a valid MCP url', () => {
    const msg = { kind: 'hostInfo', mcpUrl: 'http://127.0.0.1:8918/mcp' };
    expect(HostInfoSchema.safeParse(msg).success).toBe(true);
    expect(NativeMessageSchema.safeParse(msg).success).toBe(true);
    expect(HostInfoSchema.safeParse({ kind: 'hostInfo', mcpUrl: 'not-a-url' }).success).toBe(false);
  });

  it('accepts an optional tabId (per-tab audit view) and rejects invalid ones', () => {
    expect(AuditEntrySchema.safeParse({ ts: 1, type: 'tool_call', tabId: 42 }).success).toBe(true);
    expect(AuditEntrySchema.safeParse({ ts: 1, type: 'native_connected' }).success).toBe(true);
    expect(AuditEntrySchema.safeParse({ ts: 1, type: 'tool_call', tabId: -1 }).success).toBe(false);
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
