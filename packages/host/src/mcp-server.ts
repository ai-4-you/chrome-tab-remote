import { createServer } from 'node:http';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ToolName } from '@ctr/shared';
import { ToolCallError } from './bridge.js';

export const DEFAULT_MCP_PORT = 8917;
export const MCP_PATH = '/mcp';

/** MCP port: CTR_MCP_PORT if set and valid, else 8917. Invalid values are reported via `warn`. */
export function resolveMcpPort(
  env: NodeJS.ProcessEnv = process.env,
  warn: (line: string) => void = () => {},
): number {
  const raw = env.CTR_MCP_PORT;
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_MCP_PORT;
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    warn(`invalid CTR_MCP_PORT '${raw}', falling back to ${DEFAULT_MCP_PORT}`);
    return DEFAULT_MCP_PORT;
  }
  return port;
}

/** The subset of Bridge the MCP tools need; kept small for testability. */
export interface ToolBridge {
  callTool(tool: ToolName, params: Record<string, unknown>): Promise<unknown>;
}

function okResult(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function errorResult(error: unknown): CallToolResult {
  const text =
    error instanceof ToolCallError
      ? `${error.code}: ${error.message}`
      : `error: ${error instanceof Error ? error.message : String(error)}`;
  return { isError: true, content: [{ type: 'text', text }] };
}

/** Tool handler functions, separated from MCP wiring so they are unit-testable with a stub bridge. */
export function createToolHandlers(bridge: ToolBridge) {
  return {
    listGrants: async (): Promise<CallToolResult> => {
      try {
        // Routed through the extension (not answered from the host's cache) so
        // grant enumeration is audited like every other tool call — side-panel
        // ring buffer + host JSONL. Also fails closed instead of serving a
        // stale grant list when the extension is disconnected.
        return okResult(await bridge.callTool('list_grants', {}));
      } catch (error) {
        return errorResult(error);
      }
    },
    tabSnapshot: async ({ grantId }: { grantId: string }): Promise<CallToolResult> => {
      try {
        return okResult(await bridge.callTool('tab_snapshot', { grantId }));
      } catch (error) {
        return errorResult(error);
      }
    },
    tabRead: async ({ grantId, ref }: { grantId: string; ref: string }): Promise<CallToolResult> => {
      try {
        return okResult(await bridge.callTool('tab_read', { grantId, ref }));
      } catch (error) {
        return errorResult(error);
      }
    },
  };
}

const GRANT_ID_INPUT = z
  .string()
  .uuid()
  .describe('The grantId of an active Tab Grant, obtained via list_grants.');

/** Build one McpServer instance exposing the observe-only Stage 1 tools. */
export function createMcpServer(bridge: ToolBridge): McpServer {
  const server = new McpServer({ name: 'chrome-tab-remote', version: '0.1.0' });
  const handlers = createToolHandlers(bridge);

  server.registerTool(
    'list_grants',
    {
      description:
        'List the Tab Grants the user has currently issued in the Chrome side panel. ' +
        'chrome-tab-remote is observe-only and strictly consent-based: a grant authorizes ' +
        'read access to exactly one tab, is pinned to that tab’s origin, expires ' +
        'automatically, and can be revoked by the user at any time. Without an active ' +
        'grant no tab can be observed.',
    },
    handlers.listGrants,
  );

  server.registerTool(
    'tab_snapshot',
    {
      description:
        'Capture an accessibility-tree-like snapshot (roles, names, values, node refs) of ' +
        'the single tab the user granted observe access to. Requires a valid grantId from ' +
        'list_grants; fails if the grant is missing, expired, suspended (tab navigated to ' +
        'another origin), or revoked. Observe-only: this never modifies the page, and ' +
        'password values are always redacted.',
      inputSchema: { grantId: GRANT_ID_INPUT },
    },
    handlers.tabSnapshot,
  );

  server.registerTool(
    'tab_read',
    {
      description:
        'Read the full text content of one element from the granted tab, addressed by a ' +
        'node ref (e.g. "n42") from the most recent tab_snapshot of that tab. Requires a ' +
        'valid grantId; observe-only and subject to the same grant checks and password ' +
        'redaction as tab_snapshot.',
      inputSchema: {
        grantId: GRANT_ID_INPUT,
        ref: z
          .string()
          .regex(/^n\d+$/)
          .describe('Node ref from the latest tab_snapshot, e.g. "n42".'),
      },
    },
    handlers.tabRead,
  );

  return server;
}

export interface McpHttpServerHandle {
  port: number;
  close: () => Promise<void>;
}

export interface StartMcpHttpServerOptions {
  port?: number;
  log?: (line: string) => void;
}

/**
 * Start the Streamable HTTP MCP endpoint, bound to 127.0.0.1 only.
 * Stateless mode: a fresh McpServer + transport per request.
 */
export async function startMcpHttpServer(
  bridge: ToolBridge,
  options: StartMcpHttpServerOptions = {},
): Promise<McpHttpServerHandle> {
  const port = options.port ?? DEFAULT_MCP_PORT;
  const log = options.log ?? (() => {});
  // Resolved after listen() (needed when port 0 is requested). Mutable on
  // purpose: no request can arrive before listen() completes.
  let boundPort = port;

  const httpServer = createServer((req, res) => {
    void (async () => {
      const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
      if (pathname !== MCP_PATH) {
        res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
        return;
      }
      const server = createMcpServer(bridge);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
        // Binding to 127.0.0.1 does NOT stop DNS rebinding: a page loaded from
        // http://attacker.example:<port> whose hostname is rebound to 127.0.0.1
        // reaches this endpoint same-origin. Reject foreign Host headers, and
        // reject browser requests whose Origin is not local (non-browser MCP
        // clients send no Origin header and are unaffected).
        enableDnsRebindingProtection: true,
        allowedHosts: [`127.0.0.1:${boundPort}`, `localhost:${boundPort}`, `[::1]:${boundPort}`],
        allowedOrigins: [`http://127.0.0.1:${boundPort}`, `http://localhost:${boundPort}`],
      });
      res.on('close', () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res);
    })().catch((error: unknown) => {
      log(`mcp: request handling failed: ${error instanceof Error ? error.message : String(error)}`);
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'text/plain' }).end('internal error');
      } else {
        res.end();
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, '127.0.0.1', () => {
      httpServer.removeListener('error', reject);
      resolve();
    });
  });

  const address = httpServer.address();
  boundPort = typeof address === 'object' && address !== null ? address.port : port;
  log(`mcp: Streamable HTTP listening on http://127.0.0.1:${boundPort}${MCP_PATH}`);

  return {
    port: boundPort,
    close: () =>
      new Promise<void>((resolve, reject) => {
        httpServer.closeAllConnections();
        httpServer.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
