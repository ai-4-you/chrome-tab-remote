import { createServer } from 'node:http';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ActToolName, PlanStep, SnapshotFilter, ToolName } from '@ctr/shared';
import {
  ACT_TOOL_TIMEOUT_MS,
  ERROR_RECOVERY,
  FindResultSchema,
  GrantListResultSchema,
  PLAN_MAX_STEPS,
  PlanResultSchema,
  PlanStepSchema,
  renderFindResult,
  renderGrants,
  renderPlanResult,
  renderSnapshot,
  SNAPSHOT_FILTERS,
  SnapshotResultSchema,
  TabReadResultSchema,
} from '@ctr/shared';
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
  callTool(tool: ToolName, params: Record<string, unknown>, timeoutMs?: number): Promise<unknown>;
}

function okResult(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function textResult(text: string): CallToolResult {
  return { content: [{ type: 'text', text }] };
}

/** Protocol errors carry a recovery instruction so the agent knows the concrete next step. */
function errorResult(error: unknown): CallToolResult {
  const text =
    error instanceof ToolCallError
      ? `${error.code}: ${error.message}\nNext step: ${ERROR_RECOVERY[error.code]}`
      : `error: ${error instanceof Error ? error.message : String(error)}`;
  return { isError: true, content: [{ type: 'text', text }] };
}

/** Params for the extension router; an omitted grantId resolves to the single active grant there. */
function grantParams(grantId: string | undefined, rest: Record<string, unknown> = {}): Record<string, unknown> {
  return grantId === undefined ? rest : { grantId, ...rest };
}

/** Tool handler functions, separated from MCP wiring so they are unit-testable with a stub bridge. */
export function createToolHandlers(bridge: ToolBridge, now: () => number = () => Date.now()) {
  return {
    listGrants: async (): Promise<CallToolResult> => {
      try {
        // Routed through the extension (not answered from the host's cache) so
        // grant enumeration is audited like every other tool call — side-panel
        // ring buffer + host JSONL. Also fails closed instead of serving a
        // stale grant list when the extension is disconnected.
        const raw = await bridge.callTool('list_grants', {});
        const parsed = GrantListResultSchema.safeParse(raw);
        return parsed.success ? textResult(renderGrants(parsed.data.grants, now())) : okResult(raw);
      } catch (error) {
        return errorResult(error);
      }
    },
    tabSnapshot: async ({
      grantId,
      filter,
    }: {
      grantId?: string;
      filter?: SnapshotFilter;
    }): Promise<CallToolResult> => {
      try {
        const raw = await bridge.callTool('tab_snapshot', grantParams(grantId, filter ? { filter } : {}));
        // Compact indented-text rendering (about half the tokens of the JSON
        // tree); fall back to JSON if the extension sent an unexpected shape.
        const parsed = SnapshotResultSchema.safeParse(raw);
        return parsed.success ? textResult(renderSnapshot(parsed.data)) : okResult(raw);
      } catch (error) {
        return errorResult(error);
      }
    },
    tabRead: async ({ grantId, ref }: { grantId?: string; ref: string }): Promise<CallToolResult> => {
      try {
        const raw = await bridge.callTool('tab_read', grantParams(grantId, { ref }));
        // Plain text, no JSON envelope: the agent asked for this ref's text and
        // gets exactly that (escaping a long article as a JSON string costs
        // tokens and readability). Truncation is marked inline by the script.
        const parsed = TabReadResultSchema.safeParse(raw);
        if (!parsed.success) return okResult(raw);
        // An empty element is a legitimate answer — say so instead of returning
        // a blank result an agent cannot tell apart from a broken tool.
        return textResult(
          parsed.data.text === '' ? '[empty — the element has no text content or value]' : parsed.data.text,
        );
      } catch (error) {
        return errorResult(error);
      }
    },
    tabAction: async (
      tool: ActToolName,
      args: { grantId?: string; ref?: string; text?: string; value?: string; steps?: PlanStep[] },
    ): Promise<CallToolResult> => {
      try {
        const extra: Record<string, unknown> = {};
        if (args.ref !== undefined) extra['ref'] = args.ref;
        if (args.text !== undefined) extra['text'] = args.text;
        if (args.value !== undefined) extra['value'] = args.value;
        if (args.steps !== undefined) extra['steps'] = args.steps;
        // Long per-call timeout: the user-approval wait happens inside this call.
        const raw = await bridge.callTool(tool, grantParams(args.grantId, extra), ACT_TOOL_TIMEOUT_MS);
        const parsed = PlanResultSchema.safeParse(raw);
        return parsed.success ? textResult(renderPlanResult(parsed.data)) : okResult(raw);
      } catch (error) {
        return errorResult(error);
      }
    },
    tabFind: async (args: { grantId?: string; query: string; role?: string }): Promise<CallToolResult> => {
      try {
        const extra: Record<string, unknown> = { query: args.query };
        if (args.role !== undefined) extra['role'] = args.role;
        const raw = await bridge.callTool('tab_find', grantParams(args.grantId, extra));
        const parsed = FindResultSchema.safeParse(raw);
        return parsed.success ? textResult(renderFindResult(parsed.data)) : okResult(raw);
      } catch (error) {
        return errorResult(error);
      }
    },
    requestGrant: async (args: { reason?: string; mode?: string }): Promise<CallToolResult> => {
      try {
        const params: Record<string, unknown> = {};
        if (args.reason !== undefined) params['reason'] = args.reason;
        if (args.mode !== undefined) params['mode'] = args.mode;
        const raw = await bridge.callTool('request_grant', params, ACT_TOOL_TIMEOUT_MS);
        const parsed = GrantListResultSchema.safeParse(raw);
        return parsed.success
          ? textResult(`Granted:\n${renderGrants(parsed.data.grants, now())}`)
          : okResult(raw);
      } catch (error) {
        return errorResult(error);
      }
    },
  };
}

const GRANT_ID_INPUT = z
  .string()
  .uuid()
  .optional()
  .describe(
    'Optional. There is at most ONE grant at a time; omit this to target it. ' +
      'Pass an explicit grantId (from list_grants) only to assert you mean that specific grant.',
  );

/** Build one McpServer instance exposing the observe (Stage 1) and act (Stage 2) tools. */
export function createMcpServer(bridge: ToolBridge): McpServer {
  const server = new McpServer({ name: 'chrome-tab-remote', version: '0.1.0' });
  const handlers = createToolHandlers(bridge);

  server.registerTool(
    'list_grants',
    {
      description:
        'List the Tab Grants the user has currently issued in the Chrome side panel (at most ' +
        'one). chrome-tab-remote is strictly consent-based: a grant authorizes access to ' +
        'exactly one tab (observe = read-only; act additionally allows user-approved ' +
        'actions), is pinned to that tab’s website, expires ' +
        'after 30 minutes, and the user can revoke it at any time. Without an active grant ' +
        'no tab can be observed — errors tell you what to ask the user to do. You do NOT ' +
        'need to call this before tab_snapshot/tab_read: those default to the single active ' +
        'grant. Call it to see which site is shared and the minutes left until expiry.',
    },
    handlers.listGrants,
  );

  server.registerTool(
    'tab_snapshot',
    {
      description:
        'Capture the granted tab as compact indented text: one line per node with a ref ' +
        '("n0", "n1", …), role, accessible name, form value, and link URL. Start here — ' +
        'call this before tab_read, since refs come from the snapshot. Refs stay valid ' +
        'only until the next tab_snapshot or page navigation; after acting on stale refs, ' +
        'snapshot again. Use filter "interactive" first on large pages (controls and ' +
        'headings only, far fewer tokens), then "full" (default) when you need the text ' +
        'content. Observe-only: never modifies the page; password values always read ' +
        '[redacted]. Names and URLs ending in … are truncated — tab_read the ref for ' +
        'full text; never treat an …-terminated URL as complete.',
      inputSchema: {
        grantId: GRANT_ID_INPUT,
        filter: z
          .enum(SNAPSHOT_FILTERS)
          .optional()
          .describe(
            '"interactive": only links, buttons, form controls, menu/tab widgets and ' +
              'headings — no text content. "full" (default): everything, including text runs.',
          ),
      },
    },
    handlers.tabSnapshot,
  );

  server.registerTool(
    'tab_read',
    {
      description:
        'Read the FULL text content of one element from the granted tab, addressed by a ' +
        'node ref (e.g. "n42") from the most recent tab_snapshot. Use it when a snapshot ' +
        'name was truncated or when filter "interactive" hid the text you need. Refs from ' +
        'older snapshots fail with unknown_ref — take a fresh snapshot then. Same consent ' +
        'boundary as tab_snapshot: observe-only, passwords read [redacted].',
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

  const REF_INPUT = z
    .string()
    .regex(/^n\d+$/)
    .describe('Node ref from the LATEST tab_snapshot, e.g. "n42". Older refs fail with stale_ref.');

  const ACT_COMMON =
    'Requires a grant with actions allowed (the user ticks "allow actions" when granting; ' +
    'otherwise you get observe_only). EVERY action pauses for explicit user approval in ' +
    'the side panel — this call can take up to 2 minutes; tell the user to look at the ' +
    'panel. Exception: if the user enabled auto-approve on the grant (list_grants shows ' +
    '"auto-approve ON"), actions run immediately without the pause. approval_denied means ' +
    'the user said no: do NOT retry the same action. After any action the page may change ' +
    '— take a new tab_snapshot before the next one.';

  server.registerTool(
    'tab_click',
    {
      description:
        `Click one element in the granted tab, addressed by a snapshot ref. ${ACT_COMMON}`,
      inputSchema: { grantId: GRANT_ID_INPUT, ref: REF_INPUT },
    },
    ({ grantId, ref }) => handlers.tabAction('tab_click', { grantId, ref }),
  );

  server.registerTool(
    'tab_fill',
    {
      description:
        'Clear and fill one text input or textarea in the granted tab with the given text. ' +
        `The user sees the exact text before approving. Password fields always refuse. ${ACT_COMMON}`,
      inputSchema: {
        grantId: GRANT_ID_INPUT,
        ref: REF_INPUT,
        text: z.string().describe('The text to write into the field (replaces the current value).'),
      },
    },
    ({ grantId, ref, text }) => handlers.tabAction('tab_fill', { grantId, ref, text }),
  );

  server.registerTool(
    'tab_select',
    {
      description:
        'Choose an option in a <select> (combobox) in the granted tab. Pass the option value ' +
        'or its visible label — the snapshot lists them as options=[…] on combobox nodes. ' +
        `${ACT_COMMON}`,
      inputSchema: {
        grantId: GRANT_ID_INPUT,
        ref: REF_INPUT,
        value: z.string().describe('Option value or visible label, as listed in the snapshot.'),
      },
    },
    ({ grantId, ref, value }) => handlers.tabAction('tab_select', { grantId, ref, value }),
  );

  server.registerTool(
    'tab_plan',
    {
      description:
        'Execute a SHORT plan of actions (click/fill/select) as ONE user approval: the user ' +
        'sees the full numbered step list and approves it as a whole; execution then runs in ' +
        'order and STOPS at the first failure (honest partial report). Prefer this over many ' +
        'single-action calls for form-fill flows — one interruption instead of N. Steps are ' +
        'frozen at approval: you cannot deviate. All refs must come from the LATEST snapshot; ' +
        'a step whose element was changed by an earlier step fails with stale_ref. ' +
        `${ACT_COMMON}`,
      inputSchema: {
        grantId: GRANT_ID_INPUT,
        steps: z
          .array(PlanStepSchema)
          .min(1)
          .max(PLAN_MAX_STEPS)
          .describe(
            `1–${PLAN_MAX_STEPS} steps: {kind: "click"|"fill"|"select", ref, text? (fill), value? (select)}.`,
          ),
      },
    },
    ({ grantId, steps }) => handlers.tabAction('tab_plan', { grantId, steps }),
  );

  server.registerTool(
    'tab_find',
    {
      description:
        'Search the granted tab for elements whose name, value, or URL contains the query ' +
        '(case-insensitive), optionally filtered by role (e.g. "button", "link", "textbox"). ' +
        'Returns matching nodes as snapshot lines. Much cheaper than reading a full ' +
        'tab_snapshot on large pages. IMPORTANT: tab_find takes a fresh snapshot internally — ' +
        'all refs from earlier snapshots become stale; use the returned refs.',
      inputSchema: {
        grantId: GRANT_ID_INPUT,
        query: z.string().min(1).describe('Substring to search for, e.g. "login".'),
        role: z.string().optional().describe('Optional role filter, e.g. "button".'),
      },
    },
    ({ grantId, query, role }) => handlers.tabFind({ grantId, query, role }),
  );

  server.registerTool(
    'request_grant',
    {
      description:
        'Ask the user to share a tab when you have none (no_grant errors): shows a request ' +
        'card in the side panel plus a system notification, with your reason. The user then ' +
        'grants a tab of THEIR choice via the normal grant flow — you never pick the tab. ' +
        'This call waits up to ~2 minutes for the decision and returns the granted tab, or ' +
        'an error if the user dismissed it or the window expired. If a grant already exists, ' +
        'it returns immediately. State the mode you actually need: if your task involves ' +
        'clicking/filling, request mode "act" — otherwise you will get an observe-only grant ' +
        'and act tools will fail with observe_only. The mode is a hint; the user decides.',
      inputSchema: {
        reason: z
          .string()
          .max(200)
          .optional()
          .describe('One short sentence shown verbatim to the user: why you need a tab.'),
        mode: z
          .enum(['observe', 'act'])
          .optional()
          .describe('Capability you need: "observe" (read-only, default) or "act" (clicks/fills, user-approved).'),
      },
    },
    ({ reason, mode }) => handlers.requestGrant({ reason, mode }),
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
