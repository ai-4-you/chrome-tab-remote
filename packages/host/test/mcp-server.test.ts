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
  it('list_grants bridges to callTool and renders prose lines, not JSON', async () => {
    const callTool = vi.fn(async () => ({ grants: [GRANT] }));
    // Clock injected 12 min before the fixture's expiresAt for determinism.
    const now = () => Date.parse(GRANT.expiresAt) - 12 * 60 * 1000;
    const handlers = createToolHandlers(stubBridge({ callTool }), now);
    const result = await handlers.listGrants();
    expect(callTool).toHaveBeenCalledWith('list_grants', {});
    expect(result.isError).toBeUndefined();
    const text = textOf(result);
    expect(text).toContain('observe grant for https://docs.example.com — active, expires in ~12 min');
    expect(text).toContain(`grantId ${GRANT.grantId}`);
    expect(() => JSON.parse(text)).toThrow();
  });

  it('list_grants falls back to JSON for unexpected result shapes', async () => {
    const handlers = createToolHandlers(stubBridge({ callTool: vi.fn(async () => ({ weird: 1 })) }));
    const result = await handlers.listGrants();
    expect(JSON.parse(textOf(result))).toEqual({ weird: 1 });
  });

  it('list_grants renders the empty list as the recovery instruction', async () => {
    const handlers = createToolHandlers(stubBridge({ callTool: vi.fn(async () => ({ grants: [] })) }));
    const result = await handlers.listGrants();
    expect(textOf(result)).toContain("click 'Grant observe access'");
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

  it('tab_snapshot bridges to callTool with the grantId and falls back to JSON for unexpected shapes', async () => {
    const callTool = vi.fn(async () => ({ url: 'https://docs.example.com/', truncated: false }));
    const handlers = createToolHandlers(stubBridge({ callTool }));
    const result = await handlers.tabSnapshot({ grantId: GRANT.grantId });
    expect(callTool).toHaveBeenCalledWith('tab_snapshot', { grantId: GRANT.grantId });
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(textOf(result))).toEqual({ url: 'https://docs.example.com/', truncated: false });
  });

  it('tab_snapshot renders a valid snapshot as compact indented text, not JSON', async () => {
    const snapshot = {
      url: 'https://docs.example.com/',
      title: 'Docs',
      capturedAt: '2026-08-02T12:00:00.000Z',
      truncated: false,
      filter: 'full',
      tree: {
        ref: 'n0',
        role: 'document',
        name: 'Docs',
        children: [{ ref: 'n1', role: 'link', name: 'Home', href: 'https://docs.example.com/home' }],
      },
    };
    const handlers = createToolHandlers(stubBridge({ callTool: vi.fn(async () => snapshot) }));
    const result = await handlers.tabSnapshot({});
    expect(textOf(result)).toBe(
      [
        'url: https://docs.example.com/',
        'title: Docs',
        '- n0 document "Docs"',
        '  - n1 link "Home" https://docs.example.com/home',
      ].join('\n'),
    );
  });

  it('tab_snapshot omits grantId when not given and forwards the filter', async () => {
    const callTool = vi.fn(async () => ({}));
    const handlers = createToolHandlers(stubBridge({ callTool }));
    await handlers.tabSnapshot({ filter: 'interactive' });
    expect(callTool).toHaveBeenCalledWith('tab_snapshot', { filter: 'interactive' });
    await handlers.tabSnapshot({});
    expect(callTool).toHaveBeenLastCalledWith('tab_snapshot', {});
  });

  it('tab_read omits grantId when not given', async () => {
    const callTool = vi.fn(async () => ({ text: 'x' }));
    const handlers = createToolHandlers(stubBridge({ callTool }));
    await handlers.tabRead({ ref: 'n1' });
    expect(callTool).toHaveBeenCalledWith('tab_read', { ref: 'n1' });
  });

  it('tab_read returns the element text plainly, without a JSON envelope', async () => {
    const callTool = vi.fn(async () => ({ ref: 'n42', text: 'A quote: "hi"\nSecond line.' }));
    const handlers = createToolHandlers(stubBridge({ callTool }));
    const result = await handlers.tabRead({ grantId: GRANT.grantId, ref: 'n42' });
    expect(callTool).toHaveBeenCalledWith('tab_read', { grantId: GRANT.grantId, ref: 'n42' });
    expect(textOf(result)).toBe('A quote: "hi"\nSecond line.');
  });

  it('tab_read marks an empty element explicitly instead of returning a blank result', async () => {
    const callTool = vi.fn(async () => ({ ref: 'n5', text: '' }));
    const handlers = createToolHandlers(stubBridge({ callTool }));
    const result = await handlers.tabRead({ ref: 'n5' });
    expect(textOf(result)).toBe('[empty — the element has no text content or value]');
  });

  it('tab_read falls back to JSON for unexpected result shapes', async () => {
    const callTool = vi.fn(async () => ({ unexpected: true }));
    const handlers = createToolHandlers(stubBridge({ callTool }));
    const result = await handlers.tabRead({ grantId: GRANT.grantId, ref: 'n42' });
    expect(JSON.parse(textOf(result))).toEqual({ unexpected: true });
  });

  it('maps ToolCallError to an MCP tool error with the protocol code AND a recovery instruction', async () => {
    const callTool = vi.fn(async () => {
      throw new ToolCallError('grant_suspended', 'tab navigated to another origin');
    });
    const handlers = createToolHandlers(stubBridge({ callTool }));
    const result = await handlers.tabSnapshot({ grantId: GRANT.grantId });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('grant_suspended: tab navigated to another origin');
    expect(textOf(result)).toContain("Next step: The granted tab navigated to a different website");
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
