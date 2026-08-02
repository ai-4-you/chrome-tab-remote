// Tool-call router — every toolCall from the host is validated against the
// grant store BEFORE the tab is touched. Order of checks:
//   1. grantId present + known            -> no_grant
//   2. isGrantUsable (expiry, suspension) -> grant_expired / grant_suspended
//   3. tab still exists                   -> grant_revoked (grant is deleted)
//   4. tab origin still matches the pin   -> grant_suspended (grant is suspended)
//   5. forward to the content script      -> tab_unreachable on failure
import type { ErrorCode, ToolCallRequest, ToolResult } from '@ctr/shared';
import { isGrantUsable, ToolErrorSchema } from '@ctr/shared';
import { getGrant, listGrants, revokeGrant, suspendGrant } from './grant-store.js';
import { dropOriginPermission } from './origin-permission.js';
import { appendAudit } from './audit.js';

function errResult(id: string, code: ErrorCode, message: string): ToolResult {
  return { id, kind: 'toolResult', ok: false, error: { code, message } };
}

function okResult(id: string, result: unknown): ToolResult {
  return { id, kind: 'toolResult', ok: true, result };
}

/**
 * Deliver one message to the content script. A same-origin reload/navigation
 * destroys the programmatically injected script while the grant stays active,
 * so on failure re-inject and retry ONCE. Safe: the origin pin was re-validated
 * just before, and content/index.ts guards against double injection.
 */
async function sendToContentScript(tabId: number, message: unknown): Promise<unknown> {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    return chrome.tabs.sendMessage(tabId, message);
  }
}

/** Handle one toolCall: route, then audit the outcome (with the resolved grantId). */
export async function handleToolCall(req: ToolCallRequest): Promise<ToolResult> {
  const routed = await routeToolCall(req);
  await appendAudit({
    type: 'tool_call',
    tool: req.tool,
    grantId: routed.grantId,
    ok: routed.res.ok,
    detail: routed.res.ok ? undefined : routed.res.error.code,
  });
  return routed.res;
}

interface RoutedResult {
  res: ToolResult;
  /** The grant the call was resolved against (also when defaulted), for the audit trail. */
  grantId?: string;
}

async function routeToolCall(req: ToolCallRequest): Promise<RoutedResult> {
  if (req.tool === 'list_grants') {
    return { res: okResult(req.id, { grants: await listGrants() }) };
  }

  // grantId is optional: with at most one grant by design, an omitted grantId
  // resolves to the single existing grant.
  const grantIdParam = req.params['grantId'];
  let grant;
  if (typeof grantIdParam === 'string' && grantIdParam.length > 0) {
    grant = await getGrant(grantIdParam);
    if (!grant) {
      return { res: errResult(req.id, 'no_grant', `No grant with id ${grantIdParam}.`) };
    }
  } else {
    const grants = await listGrants();
    grant = grants[0];
    if (!grant) {
      return { res: errResult(req.id, 'no_grant', 'No active grant.') };
    }
  }

  const grantId = grant.grantId;

  const usable = isGrantUsable(grant);
  if (!usable.ok) {
    return { res: errResult(req.id, usable.code, `Grant is not usable (${usable.code}).`), grantId };
  }

  // Tab must still exist.
  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(grant.tabId);
  } catch {
    await revokeGrant(grantId);
    await dropOriginPermission(grant.origin);
    await appendAudit({ type: 'grant_revoked', grantId, detail: 'granted tab no longer exists' });
    return { res: errResult(req.id, 'grant_revoked', 'The granted tab no longer exists; grant revoked.'), grantId };
  }

  // Origin pin — defense in depth in case a navigation slipped past tabs.onUpdated.
  let sameOrigin = false;
  try {
    sameOrigin = new URL(tab.url ?? '').origin === grant.origin;
  } catch {
    sameOrigin = false;
  }
  if (!sameOrigin) {
    await suspendGrant(grantId);
    await appendAudit({ type: 'grant_suspended', grantId, detail: 'origin mismatch at tool call' });
    return { res: errResult(req.id, 'grant_suspended', 'Tab origin no longer matches the grant; grant suspended.'), grantId };
  }

  // Build the content-script message.
  let message: { type: string; ref?: string; filter?: string };
  if (req.tool === 'tab_snapshot') {
    const filter = req.params['filter'] === 'interactive' ? 'interactive' : 'full';
    message = { type: 'ctrSnapshot', filter };
  } else {
    const ref = req.params['ref'];
    if (typeof ref !== 'string' || ref.length === 0) {
      return { res: errResult(req.id, 'unknown_ref', 'Missing ref parameter.'), grantId };
    }
    message = { type: 'ctrRead', ref };
  }

  let resp: unknown;
  try {
    resp = await sendToContentScript(grant.tabId, message);
  } catch {
    return { res: errResult(req.id, 'tab_unreachable', 'Content script did not respond.'), grantId };
  }

  if (resp && typeof resp === 'object' && 'ok' in resp) {
    const r = resp as { ok: boolean; result?: unknown; error?: unknown };
    if (r.ok) return { res: okResult(req.id, r.result), grantId };
    const parsed = ToolErrorSchema.safeParse(r.error);
    if (parsed.success) return { res: errResult(req.id, parsed.data.code, parsed.data.message), grantId };
  }
  return { res: errResult(req.id, 'tab_unreachable', 'Malformed response from content script.'), grantId };
}
