import { describe, expect, it, vi } from 'vitest';
import type { Grant } from '@ctr/shared';
import { ToolCallError } from '../src/bridge.js';
import {
  createToolHandlers,
  resolveMcpPort,
  DEFAULT_MCP_PORT,
  type ToolBridge,
} from '../src/mcp-server.js';
import { resolveDataDir } from '../src/audit-log.js';

const GRANT: Grant = {
  grantId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  tabId: 3,
  origin: 'https://docs.example.com',
  mode: 'observe',
  status: 'active',
  expiresAt: '2026-08-02T12:00:00.000Z',
  createdByGesture: true,
};

function stubBridge(overrides: Partial<ToolBridge> = {}): ToolBridge {
  return {
    callTool: vi.fn(async () => ({ some: 'result' })),
    ...overrides,
  };
}

function textOf(result: { content: { type: string; text?: string }[] }): string {
  return result.content[0]?.text ?? '';
}

describe('createToolHandlers', () => {
  it('list_grants bridges to callTool so the extension audits the enumeration', async () => {
    const callTool = vi.fn(async () => ({ grants: [GRANT] }));
    const handlers = createToolHandlers(stubBridge({ callTool }));
    const result = await handlers.listGrants();
    expect(callTool).toHaveBeenCalledWith('list_grants', {});
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(textOf(result))).toEqual({ grants: [GRANT] });
  });

  it('list_grants fails closed when the extension is unreachable (no stale cache)', async () => {
    const callTool = vi.fn(async () => {
      throw new ToolCallError('timeout', "toolCall 'list_grants' timed out after 15000 ms");
    });
    const handlers = createToolHandlers(stubBridge({ callTool }));
    const result = await handlers.listGrants();
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('timeout:');
  });

  it('tab_snapshot bridges to callTool with the grantId and wraps the result', async () => {
    const callTool = vi.fn(async () => ({ url: 'https://docs.example.com/', truncated: false }));
    const handlers = createToolHandlers(stubBridge({ callTool }));
    const result = await handlers.tabSnapshot({ grantId: GRANT.grantId });
    expect(callTool).toHaveBeenCalledWith('tab_snapshot', { grantId: GRANT.grantId });
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(textOf(result))).toEqual({ url: 'https://docs.example.com/', truncated: false });
  });

  it('tab_read bridges to callTool with grantId and ref', async () => {
    const callTool = vi.fn(async () => ({ text: 'full element text' }));
    const handlers = createToolHandlers(stubBridge({ callTool }));
    const result = await handlers.tabRead({ grantId: GRANT.grantId, ref: 'n42' });
    expect(callTool).toHaveBeenCalledWith('tab_read', { grantId: GRANT.grantId, ref: 'n42' });
    expect(JSON.parse(textOf(result))).toEqual({ text: 'full element text' });
  });

  it('maps ToolCallError to an MCP tool error with the protocol code', async () => {
    const callTool = vi.fn(async () => {
      throw new ToolCallError('grant_suspended', 'tab navigated to another origin');
    });
    const handlers = createToolHandlers(stubBridge({ callTool }));
    const result = await handlers.tabSnapshot({ grantId: GRANT.grantId });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('grant_suspended: tab navigated to another origin');
  });

  it('maps timeouts to an MCP tool error', async () => {
    const callTool = vi.fn(async () => {
      throw new ToolCallError('timeout', "toolCall 'tab_read' timed out after 15000 ms");
    });
    const handlers = createToolHandlers(stubBridge({ callTool }));
    const result = await handlers.tabRead({ grantId: GRANT.grantId, ref: 'n1' });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('timeout:');
  });

  it('maps unexpected errors without inventing a protocol code', async () => {
    const callTool = vi.fn(async () => {
      throw new Error('kaboom');
    });
    const handlers = createToolHandlers(stubBridge({ callTool }));
    const result = await handlers.tabSnapshot({ grantId: GRANT.grantId });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('error: kaboom');
  });
});

describe('resolveMcpPort', () => {
  it('defaults to 8917', () => {
    expect(resolveMcpPort({})).toBe(DEFAULT_MCP_PORT);
    expect(DEFAULT_MCP_PORT).toBe(8917);
  });

  it('honors CTR_MCP_PORT', () => {
    expect(resolveMcpPort({ CTR_MCP_PORT: '9001' })).toBe(9001);
  });

  it('falls back (with warning) on invalid values', () => {
    const warn = vi.fn();
    expect(resolveMcpPort({ CTR_MCP_PORT: 'not-a-port' }, warn)).toBe(DEFAULT_MCP_PORT);
    expect(resolveMcpPort({ CTR_MCP_PORT: '0' }, warn)).toBe(DEFAULT_MCP_PORT);
    expect(resolveMcpPort({ CTR_MCP_PORT: '70000' }, warn)).toBe(DEFAULT_MCP_PORT);
    expect(warn).toHaveBeenCalledTimes(3);
  });
});

describe('resolveDataDir', () => {
  it('honors CTR_DATA_DIR', () => {
    expect(resolveDataDir({ CTR_DATA_DIR: '/somewhere/custom' })).toBe('/somewhere/custom');
  });

  it('defaults to ~/.chrome-tab-remote', () => {
    expect(resolveDataDir({})).toMatch(/\/\.chrome-tab-remote$/);
  });
});
