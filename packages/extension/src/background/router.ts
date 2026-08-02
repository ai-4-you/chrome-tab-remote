// Tool-call router — every toolCall from the host is validated against the
// grant store BEFORE the tab is touched. Order of checks:
//   1. grantId present (or defaulted to the single grant) -> no_grant
//   2. isGrantUsable (expiry, suspension) -> grant_expired / grant_suspended
//   3. tab still exists                   -> grant_revoked (grant is deleted)
//   4. tab origin still matches the pin   -> grant_suspended (grant is suspended)
//   5. observe tools: forward to the content script
//      act tools: mode check -> describe target -> USER APPROVAL -> re-validate
//      (the approval wait is long) -> execute
import type { ErrorCode, Grant, ToolCallRequest, ToolResult } from '@ctr/shared';
import { isActTool, isGrantUsable, ToolErrorSchema } from '@ctr/shared';
import { proposeApproval } from './approvals.js';
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

/** Map a content-script response ({ok, result|error}) into a ToolResult. */
function mapContentResponse(id: string, resp: unknown): ToolResult {
  if (resp && typeof resp === 'object' && 'ok' in resp) {
    const r = resp as { ok: boolean; result?: unknown; error?: unknown };
    if (r.ok) return okResult(id, r.result);
    const parsed = ToolErrorSchema.safeParse(r.error);
    if (parsed.success) return errResult(id, parsed.data.code, parsed.data.message);
  }
  return errResult(id, 'tab_unreachable', 'Malformed response from content script.');
}

/** Handle one toolCall: route, then audit the outcome (with the resolved grant + tab). */
export async function handleToolCall(req: ToolCallRequest): Promise<ToolResult> {
  const routed = await routeToolCall(req);
  await appendAudit({
    type: 'tool_call',
    tool: req.tool,
    grantId: routed.grantId,
    tabId: routed.tabId,
    ok: routed.res.ok,
    detail: routed.res.ok ? undefined : routed.res.error.code,
  });
  return routed.res;
}

interface RoutedResult {
  res: ToolResult;
  /** The grant the call was resolved against (also when defaulted), for the audit trail. */
  grantId?: string;
  /** The granted tab, for the panel's per-tab audit view. */
  tabId?: number;
}

/**
 * Checks 2–4: usability, tab existence, live origin pin. Called before every
 * tab access — including AGAIN after an approval wait, since minutes may have
 * passed and the grant may have expired, been suspended, or lost its tab.
 */
async function validateGrantForCall(reqId: string, grantId: string): Promise<{ grant: Grant } | { res: ToolResult }> {
  const grant = await getGrant(grantId);
  if (!grant) {
    return { res: errResult(reqId, 'no_grant', `No grant with id ${grantId}.`) };
  }
  const usable = isGrantUsable(grant);
  if (!usable.ok) {
    return { res: errResult(reqId, usable.code, `Grant is not usable (${usable.code}).`) };
  }
  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(grant.tabId);
  } catch {
    await revokeGrant(grant.grantId);
    await dropOriginPermission(grant.origin);
    await appendAudit({
      type: 'grant_revoked',
      grantId: grant.grantId,
      tabId: grant.tabId,
      detail: 'granted tab no longer exists',
    });
    return { res: errResult(reqId, 'grant_revoked', 'The granted tab no longer exists; grant revoked.') };
  }
  // Origin pin — defense in depth in case a navigation slipped past tabs.onUpdated.
  let sameOrigin = false;
  try {
    sameOrigin = new URL(tab.url ?? '').origin === grant.origin;
  } catch {
    sameOrigin = false;
  }
  if (!sameOrigin) {
    await suspendGrant(grant.grantId);
    await appendAudit({
      type: 'grant_suspended',
      grantId: grant.grantId,
      tabId: grant.tabId,
      detail: 'origin mismatch at tool call',
    });
    return { res: errResult(reqId, 'grant_suspended', 'Tab origin no longer matches the grant; grant suspended.') };
  }
  return { grant };
}

async function routeToolCall(req: ToolCallRequest): Promise<RoutedResult> {
  if (req.tool === 'list_grants') {
    return { res: okResult(req.id, { grants: await listGrants() }) };
  }

  // grantId is optional: with at most one grant by design, an omitted grantId
  // resolves to the single existing grant.
  const grantIdParam = req.params['grantId'];
  let resolved: Grant | undefined;
  if (typeof grantIdParam === 'string' && grantIdParam.length > 0) {
    resolved = await getGrant(grantIdParam);
    if (!resolved) {
      return { res: errResult(req.id, 'no_grant', `No grant with id ${grantIdParam}.`) };
    }
  } else {
    resolved = (await listGrants())[0];
    if (!resolved) {
      return { res: errResult(req.id, 'no_grant', 'No active grant.') };
    }
  }
  const grantId = resolved.grantId;
  const tabId = resolved.tabId;

  const validated = await validateGrantForCall(req.id, grantId);
  if ('res' in validated) return { res: validated.res, grantId, tabId };
  const grant = validated.grant;

  if (isActTool(req.tool)) {
    return { res: await routeActTool(req, grant), grantId, tabId };
  }

  // Observe tools.
  let message: { type: string; ref?: string; filter?: string };
  if (req.tool === 'tab_snapshot') {
    const filter = req.params['filter'] === 'interactive' ? 'interactive' : 'full';
    message = { type: 'ctrSnapshot', filter };
  } else {
    const ref = req.params['ref'];
    if (typeof ref !== 'string' || ref.length === 0) {
      return { res: errResult(req.id, 'unknown_ref', 'Missing ref parameter.'), grantId, tabId };
    }
    message = { type: 'ctrRead', ref };
  }

  let resp: unknown;
  try {
    resp = await sendToContentScript(grant.tabId, message);
  } catch {
    return { res: errResult(req.id, 'tab_unreachable', 'Content script did not respond.'), grantId, tabId };
  }
  return { res: mapContentResponse(req.id, resp), grantId, tabId };
}

/** The act path: mode gate → target description → user approval → re-validation → execution. */
async function routeActTool(req: ToolCallRequest, grant: Grant): Promise<ToolResult> {
  if (grant.mode !== 'act') {
    return errResult(req.id, 'observe_only', 'The grant is observe-only; actions are not authorized.');
  }
  if (!isActTool(req.tool)) {
    return errResult(req.id, 'invalid_target', 'Not an action tool.');
  }
  const ref = req.params['ref'];
  if (typeof ref !== 'string' || ref.length === 0) {
    return errResult(req.id, 'unknown_ref', 'Missing ref parameter.');
  }

  // Build the action + the human detail shown to the user.
  let action: { kind: 'click' | 'fill' | 'select'; ref: string; text?: string; value?: string };
  let detail: string | undefined;
  if (req.tool === 'tab_click') {
    action = { kind: 'click', ref };
  } else if (req.tool === 'tab_fill') {
    const text = req.params['text'];
    if (typeof text !== 'string') {
      return errResult(req.id, 'invalid_target', 'Missing text parameter for tab_fill.');
    }
    action = { kind: 'fill', ref, text };
    detail = `type ${JSON.stringify(text)}`;
  } else {
    const value = req.params['value'];
    if (typeof value !== 'string') {
      return errResult(req.id, 'invalid_target', 'Missing value parameter for tab_select.');
    }
    action = { kind: 'select', ref, value };
    detail = `choose ${JSON.stringify(value)}`;
  }

  // Pre-approval peek: reject stale/unknown refs BEFORE bothering the user,
  // and learn what the element is so the user approves an informed description.
  let describeResp: unknown;
  try {
    describeResp = await sendToContentScript(grant.tabId, { type: 'ctrDescribe', ref });
  } catch {
    return errResult(req.id, 'tab_unreachable', 'Content script did not respond.');
  }
  const described = mapContentResponse(req.id, describeResp);
  if (!described.ok) return described;
  const target =
    typeof (described.result as { target?: unknown })?.target === 'string'
      ? (described.result as { target: string }).target
      : ref;

  const proposedDetail = detail ? `${target} — ${detail}` : target;

  // Auto-approve ("YOLO", C-9): read the CURRENT grant state at the gate — the
  // user can flip the toggle at any moment and it must apply immediately.
  const freshGrant = await getGrant(grant.grantId);
  if (freshGrant?.autoApprove === true && freshGrant.mode === 'act') {
    await appendAudit({
      type: 'action_auto_approved',
      grantId: grant.grantId,
      tabId: grant.tabId,
      tool: req.tool,
      detail: proposedDetail,
    });
    let yoloResp: unknown;
    try {
      yoloResp = await sendToContentScript(grant.tabId, { type: 'ctrAction', action });
    } catch {
      return errResult(req.id, 'tab_unreachable', 'Content script did not respond.');
    }
    return mapContentResponse(req.id, yoloResp);
  }

  // Approval gate (C-3/C-4).
  const opId = crypto.randomUUID();
  await appendAudit({ type: 'action_proposed', grantId: grant.grantId, tabId: grant.tabId, tool: req.tool, detail: proposedDetail });
  const decision = await proposeApproval({
    opId,
    tool: req.tool,
    ref,
    target,
    detail,
    origin: grant.origin,
  });
  if (decision === 'busy') {
    return errResult(
      req.id,
      'approval_timeout',
      "Another action is already awaiting the user's decision — retry after it resolves.",
    );
  }
  if (decision === 'denied') {
    await appendAudit({ type: 'action_denied', grantId: grant.grantId, tabId: grant.tabId, tool: req.tool, detail: proposedDetail });
    return errResult(req.id, 'approval_denied', `The user declined: ${req.tool} on ${target}.`);
  }
  if (decision === 'timeout') {
    await appendAudit({ type: 'action_timeout', grantId: grant.grantId, tabId: grant.tabId, tool: req.tool, detail: proposedDetail });
    return errResult(req.id, 'approval_timeout', 'No user decision within the approval window.');
  }
  await appendAudit({ type: 'action_approved', grantId: grant.grantId, tabId: grant.tabId, tool: req.tool, detail: proposedDetail });

  // The approval wait can last minutes: re-validate everything before touching the tab.
  const revalidated = await validateGrantForCall(req.id, grant.grantId);
  if ('res' in revalidated) return revalidated.res;

  let execResp: unknown;
  try {
    execResp = await sendToContentScript(revalidated.grant.tabId, { type: 'ctrAction', action });
  } catch {
    return errResult(req.id, 'tab_unreachable', 'Content script did not respond.');
  }
  return mapContentResponse(req.id, execResp);
}
