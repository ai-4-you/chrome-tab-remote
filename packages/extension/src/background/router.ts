// Tool-call router — every toolCall from the host is validated against the
// grant store BEFORE the tab is touched. Order of checks:
//   1. grantId present (or defaulted to the single grant) -> no_grant
//   2. isGrantUsable (expiry, suspension) -> grant_expired / grant_suspended
//   3. tab still exists                   -> grant_revoked (grant is deleted)
//   4. tab origin still matches the pin   -> grant_suspended (grant is suspended)
//   5. observe tools: forward to the content script
//      act tools: mode check -> describe target -> USER APPROVAL -> re-validate
//      (the approval wait is long) -> execute
import type { ErrorCode, Grant, NavigateResult, PlanStep, ToolCallRequest, ToolResult } from '@ctr/shared';
import { isActTool, isGrantUsable, PLAN_MAX_STEPS, PlanStepSchema, SCROLL_DEFAULT_PIXELS, ToolErrorSchema } from '@ctr/shared';
import { z } from 'zod';
import { proposeApproval, type ApprovalStep } from './approvals.js';
import { proposeGrantRequest } from './grant-requests.js';
import { getGrant, listGrants, revokeGrant, suspendGrant } from './grant-store.js';
import { dropOriginPermission } from './origin-permission.js';
import { appendAudit } from './audit.js';
import { waitTabLoad } from './navigate-wait.js';

function errResult(id: string, code: ErrorCode, message: string): ToolResult {
  return { id, kind: 'toolResult', ok: false, error: { code, message } };
}

function okResult(id: string, result: unknown): ToolResult {
  return { id, kind: 'toolResult', ok: true, result };
}

// One navigate in flight per grant (Freaky back-to-back navigates would
// otherwise interleave load-waits and mis-attribute the result).
const inFlightNavigates = new Set<string>();

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

// The native-message reader rejects oversized frames. This leaves ample room
// for the JSON envelope and keeps a screenshot from destabilising the channel.
const MAX_VIEWPORT_SCREENSHOT_BASE64_BYTES = 600 * 1024;

function decodedByteLength(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return (base64.length * 3) / 4 - padding;
}

/** Capture only the already-visible granted tab; never steal focus to do so. */
async function captureViewportScreenshot(reqId: string, grant: Grant, tab: chrome.tabs.Tab): Promise<ToolResult> {
  if (grant.allowViewportScreenshot !== true) {
    return errResult(reqId, 'screenshot_not_allowed', 'Viewport screenshots are not authorized for this grant.');
  }
  if (tab.active !== true || tab.windowId === undefined) {
    return errResult(reqId, 'tab_not_visible', 'The granted tab is not active in its window.');
  }

  let dataUrl: string;
  try {
    dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 50 });
  } catch (error) {
    return errResult(reqId, 'screenshot_capture_failed', `Viewport screenshot failed: ${String(error)}`);
  }

  // The capture call is asynchronous: re-check revocation, expiry, status, and
  // origin before exposing any pixels captured under the earlier authorization.
  const revalidated = await validateGrantForCall(reqId, grant.grantId);
  if ('res' in revalidated) return revalidated.res;
  if (revalidated.grant.allowViewportScreenshot !== true) {
    return errResult(reqId, 'screenshot_not_allowed', 'Viewport screenshots are no longer authorized for this grant.');
  }

  // captureVisibleTab takes a window rather than a tab id. Discard pixels if
  // the active tab changed during capture, including a same-origin navigation.
  let activeTab: chrome.tabs.Tab | undefined;
  try {
    [activeTab] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
  } catch (error) {
    return errResult(reqId, 'tab_not_visible', `Could not confirm the active tab after capture: ${String(error)}`);
  }
  if (activeTab?.id !== revalidated.grant.tabId || activeTab.url !== revalidated.tab.url) {
    return errResult(reqId, 'tab_not_visible', 'The granted tab changed or lost focus during capture; image discarded.');
  }

  const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) {
    return errResult(reqId, 'tab_unreachable', 'Viewport screenshot returned an invalid image payload.');
  }
  const data = match[1];
  if (!data) {
    return errResult(reqId, 'tab_unreachable', 'Viewport screenshot returned an invalid image payload.');
  }
  if (data.length > MAX_VIEWPORT_SCREENSHOT_BASE64_BYTES) {
    return errResult(
      reqId,
      'screenshot_too_large',
      `Viewport screenshot is ${decodedByteLength(data)} bytes, above the safe transfer limit.`,
    );
  }
  return okResult(reqId, {
    mimeType: 'image/jpeg',
    data,
    url: tab.url ?? grant.origin,
    title: tab.title ?? '',
  });
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
async function validateGrantForCall(reqId: string, grantId: string): Promise<{ grant: Grant; tab: chrome.tabs.Tab } | { res: ToolResult }> {
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
  return { grant, tab };
}

async function routeToolCall(req: ToolCallRequest): Promise<RoutedResult> {
  if (req.tool === 'list_grants') {
    return { res: okResult(req.id, { grants: await listGrants() }) };
  }

  // request_grant works WITHOUT a grant — it is how the agent asks for one.
  // The answer is always the user's normal grant gesture; this only carries
  // the question (with reason) into the panel + a notification.
  if (req.tool === 'request_grant') {
    const existing = await listGrants();
    if (existing[0]) {
      return { res: okResult(req.id, { grants: existing }) };
    }
    const reason =
      typeof req.params['reason'] === 'string' ? req.params['reason'].slice(0, 200) : undefined;
    const requestedMode = req.params['mode'] === 'act' ? 'act' : 'observe';
    await appendAudit({
      type: 'grant_requested',
      detail: `${requestedMode}${reason ? `: ${reason}` : ''}`,
    });
    const outcome = await proposeGrantRequest(reason, requestedMode);
    if (outcome === 'granted') {
      return { res: okResult(req.id, { grants: await listGrants() }) };
    }
    if (outcome === 'busy') {
      return { res: errResult(req.id, 'busy', 'An access request is already pending.') };
    }
    await appendAudit({ type: 'grant_request_dismissed', detail: outcome });
    return {
      res: errResult(
        req.id,
        'no_grant',
        outcome === 'dismissed'
          ? 'The user dismissed the access request.'
          : 'No grant was given within the request window.',
      ),
    };
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

  if (req.tool === 'tab_screenshot_viewport') {
    return { res: await captureViewportScreenshot(req.id, grant, validated.tab), grantId, tabId };
  }

  if (req.tool === 'tab_navigate') {
    return { res: await routeNavigate(req, grant, validated.tab), grantId, tabId };
  }

  if (isActTool(req.tool)) {
    return { res: await routeActTool(req, grant), grantId, tabId };
  }

  // Observe tools.
  let message: { type: string; ref?: string; refs?: string[]; filter?: string; query?: string; role?: string };
  if (req.tool === 'tab_snapshot') {
    const filter = req.params['filter'] === 'interactive' ? 'interactive' : 'full';
    message = { type: 'ctrSnapshot', filter };
  } else if (req.tool === 'tab_find') {
    const query = req.params['query'];
    if (typeof query !== 'string' || query.trim().length === 0) {
      return { res: errResult(req.id, 'unknown_ref', 'Missing query parameter for tab_find.'), grantId, tabId };
    }
    message = { type: 'ctrFind', query };
    if (typeof req.params['role'] === 'string') message.role = req.params['role'];
  } else if (req.tool === 'tab_read_many') {
    const refs = req.params['refs'];
    if (!Array.isArray(refs) || refs.length < 1 || refs.length > 100 || !refs.every((ref) => typeof ref === 'string' && /^n\d+$/.test(ref))) {
      return { res: errResult(req.id, 'invalid_target', 'refs must contain 1–100 node refs.'), grantId, tabId };
    }
    message = { type: 'ctrReadMany', refs };
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

/** Human line for one step, shown in approvals and audit. */
function stepDetail(step: PlanStep): string | undefined {
  if (step.kind === 'fill') return `type ${JSON.stringify(step.text ?? '')}`;
  if (step.kind === 'select') return `choose ${JSON.stringify(step.value ?? '')}`;
  if (step.kind === 'scroll') {
    // Element mode has no direction/distance: it brings the element into view
    // (block:'center'). The card says exactly that — nothing the executor ignores.
    return step.ref === 'page'
      ? `${step.direction} ${step.pixels ?? SCROLL_DEFAULT_PIXELS}px (page scroller or inner feed container)`
      : 'scroll into view (centre of the viewport)';
  }
  return undefined;
}

/**
 * Page-mode scroll targets a static description, not a snapshot ref: nothing exists
 * to ctrDescribe, so the approval card shows this human string instead.
 */
function pageScrollTarget(step: PlanStep): string {
  return `page ${step.direction} ${step.pixels ?? SCROLL_DEFAULT_PIXELS}px`;
}

/**
 * The act path (plan-unified, C-10): mode gate → build/validate steps →
 * describe all targets (stale refs rejected before the user is asked) →
 * gate (approval or auto-approve) → re-validation → sequential execution
 * with settle state, producing a receipt that is honest about interruptions.
 */
async function routeActTool(req: ToolCallRequest, grant: Grant): Promise<ToolResult> {
  if (grant.mode !== 'act') {
    return errResult(req.id, 'observe_only', 'The grant is observe-only; actions are not authorized.');
  }

  // Build the frozen step list. Single-action tools are 1-step plans.
  let steps: PlanStep[];
  if (req.tool === 'tab_plan') {
    const parsed = z.array(PlanStepSchema).min(1).max(PLAN_MAX_STEPS).safeParse(req.params['steps']);
    if (!parsed.success) {
      return errResult(
        req.id,
        'invalid_target',
        `Invalid steps (1–${PLAN_MAX_STEPS} of {kind: click|fill|select|scroll, ref, text?, value?, direction?+pixels?/behavior? for page scroll}): ${parsed.error.issues[0]?.message ?? 'schema mismatch'}`,
      );
    }
    steps = parsed.data;
  } else if (req.tool === 'tab_scroll') {
    const ref = req.params['ref'];
    const direction = req.params['direction'];
    const rawPixels = req.params['pixels'];
    const behavior = req.params['behavior'];
    const badPixels =
      rawPixels !== undefined &&
      !(Number.isInteger(rawPixels) && (rawPixels as number) >= 1 && (rawPixels as number) <= 10_000);
    if (badPixels) {
      return errResult(req.id, 'invalid_target', 'pixels must be an integer between 1 and 10000.');
    }
    const pixels = rawPixels as number | undefined;
    if (behavior !== undefined && behavior !== 'instant' && behavior !== 'auto') {
      return errResult(req.id, 'invalid_target', "behavior must be 'instant' or 'auto'.");
    }
    if (ref === 'page' || ref === undefined) {
      // Page mode: direction is required (same rule as the shared schema).
      if (direction !== 'down' && direction !== 'up') {
        return errResult(
          req.id,
          'invalid_target',
          "Page-mode scroll requires direction: 'down' | 'up'. Pass an element ref from tab_snapshot to scroll one element into view.",
        );
      }
      steps = [{ kind: 'scroll', ref: 'page', direction, pixels, behavior }];
    } else {
      if (typeof ref !== 'string' || !/^n\d+$/.test(ref)) {
        return errResult(req.id, 'unknown_ref', 'ref must be a node ref (e.g. "n42") or "page".');
      }
      // Element mode brings the element into view; distance and direction would be
      // silently ignored, so they are refused rather than accepted-and-dropped.
      if (pixels !== undefined) {
        return errResult(
          req.id,
          'invalid_target',
          'pixels applies to page mode only; an element ref scrolls into view. Omit pixels (and direction) for element mode.',
        );
      }
      if (direction !== undefined) {
        return errResult(
          req.id,
          'invalid_target',
          "direction applies to page mode only; an element ref scrolls into view. Omit direction for element mode, or pass direction with ref 'page' to scroll the page.",
        );
      }
      if (behavior !== undefined) {
        return errResult(
          req.id,
          'invalid_target',
          "behavior applies to page mode only; an element ref scrolls into view instantly. Omit behavior for element mode.",
        );
      }
      steps = [{ kind: 'scroll', ref } as PlanStep];
    }
  } else {
    const ref = req.params['ref'];
    if (typeof ref !== 'string' || ref.length === 0) {
      return errResult(req.id, 'unknown_ref', 'Missing ref parameter.');
    }
    if (req.tool === 'tab_click') {
      steps = [{ kind: 'click', ref }];
    } else if (req.tool === 'tab_fill') {
      const text = req.params['text'];
      if (typeof text !== 'string') {
        return errResult(req.id, 'invalid_target', 'Missing text parameter for tab_fill.');
      }
      steps = [{ kind: 'fill', ref, text }];
    } else {
      const value = req.params['value'];
      if (typeof value !== 'string') {
        return errResult(req.id, 'invalid_target', 'Missing value parameter for tab_select.');
      }
      steps = [{ kind: 'select', ref, value }];
    }
  }
  for (const [i, step] of steps.entries()) {
    if (step.kind === 'fill' && typeof step.text !== 'string') {
      return errResult(req.id, 'invalid_target', `Step ${i + 1}: fill requires text.`);
    }
    if (step.kind === 'select' && typeof step.value !== 'string') {
      return errResult(req.id, 'invalid_target', `Step ${i + 1}: select requires value.`);
    }
  }

  // Pre-approval peek: describe EVERY target so the user approves an informed
  // list, and stale/unknown refs never reach the user at all.
  const approvalSteps: ApprovalStep[] = [];
  for (const step of steps) {
    if (step.kind === 'scroll' && step.ref === 'page') {
      // Static target: no ctrDescribe round-trip — there is no element to describe.
      approvalSteps.push({ kind: step.kind, target: pageScrollTarget(step), detail: stepDetail(step) });
      continue;
    }
    let describeResp: unknown;
    try {
      describeResp = await sendToContentScript(grant.tabId, { type: 'ctrDescribe', ref: step.ref });
    } catch {
      return errResult(req.id, 'tab_unreachable', 'Content script did not respond.');
    }
    const described = mapContentResponse(req.id, describeResp);
    if (!described.ok) return described;
    const target =
      typeof (described.result as { target?: unknown })?.target === 'string'
        ? (described.result as { target: string }).target
        : step.ref;
    approvalSteps.push({ kind: step.kind, target, detail: stepDetail(step) });
  }
  const proposedDetail = approvalSteps
    .map((s, i) => `${i + 1}. ${s.kind} ${s.target}${s.detail ? ` — ${s.detail}` : ''}`)
    .join('; ')
    .slice(0, 400);

  // Gate: auto-approve ("Freaky mode", C-9) reads the CURRENT grant state —
  // the user can flip the toggle at any moment and it applies per plan.
  const freshGrant = await getGrant(grant.grantId);
  if (freshGrant?.autoApprove === true && freshGrant.mode === 'act') {
    await appendAudit({
      type: 'action_auto_approved',
      grantId: grant.grantId,
      tabId: grant.tabId,
      tool: req.tool,
      detail: proposedDetail,
    });
  } else {
    const opId = crypto.randomUUID();
    await appendAudit({ type: 'action_proposed', grantId: grant.grantId, tabId: grant.tabId, tool: req.tool, detail: proposedDetail });
    const decision = await proposeApproval({ opId, steps: approvalSteps, origin: grant.origin });
    if (decision === 'busy') {
      return errResult(req.id, 'busy', "Another action is already awaiting the user's decision.");
    }
    if (decision === 'denied') {
      await appendAudit({ type: 'action_denied', grantId: grant.grantId, tabId: grant.tabId, tool: req.tool, detail: proposedDetail });
      return errResult(req.id, 'approval_denied', `The user declined: ${proposedDetail}.`);
    }
    if (decision === 'timeout') {
      await appendAudit({ type: 'action_timeout', grantId: grant.grantId, tabId: grant.tabId, tool: req.tool, detail: proposedDetail });
      return errResult(req.id, 'approval_timeout', 'No user decision within the approval window.');
    }
    await appendAudit({ type: 'action_approved', grantId: grant.grantId, tabId: grant.tabId, tool: req.tool, detail: proposedDetail });

    // The approval wait can last minutes: re-validate everything before touching the tab.
    const revalidated = await validateGrantForCall(req.id, grant.grantId);
    if ('res' in revalidated) return revalidated.res;
  }

  // Execute. NO auto-retry here: a lost channel usually means an action
  // navigated the page — retrying would re-execute approved actions.
  let execResp: unknown;
  try {
    execResp = await chrome.tabs.sendMessage(grant.tabId, { type: 'ctrPlan', steps });
  } catch {
    return okResult(req.id, { executed: [], pageState: 'interrupted' });
  }
  return mapContentResponse(req.id, execResp);
}

// --- tab_navigate (C-12) -------------------------------------------------------
//
// A background-side branch, NOT a plan step: navigation kills the content
// channel that would deliver a plan receipt. Two-tier semantics:
//   (a) same-origin destination: grant stays active, normal receipt;
//   (b) cross-origin destination: the navigation happens, the origin pin
//       (G-3) auto-suspends the grant, and the result is OK with
//       grantStatus 'suspended' + an honest Next step for re-consent.

/** Max length of the raw URL string before any parsing (spec §3.1). */
const NAVIGATE_MAX_URL_LENGTH = 2048;

/**
 * Spec §3.1 validation, all BEFORE the user is asked:
 * backslash/control pre-checks, parse, http(s) scheme, no embedded credentials.
 * Returns the parsed URL, or the concrete error result.
 */
function validateNavigateUrl(
  reqId: string,
  raw: unknown,
): { url: URL; raw: string } | { res: ToolResult } {
  if (typeof raw !== 'string' || raw.length === 0) {
    return { res: errResult(reqId, 'navigate_bad_url', 'Missing url parameter (must be a non-empty http(s) URL).') };
  }
  if (raw.length > NAVIGATE_MAX_URL_LENGTH) {
    return {
      res: errResult(
        reqId,
        'navigate_bad_url',
        `URL is ${raw.length} characters, above the ${NAVIGATE_MAX_URL_LENGTH}-character limit.`,
      ),
    };
  }
  // Belt-and-braces raw-string pre-checks (F4): a backslash or a control
  // character is never legal in an http(s) URL an agent should send.
  for (const ch of raw) {
    if (ch === '\\') {
      return { res: errResult(reqId, 'navigate_bad_url', 'URL contains a backslash, which is not a legal URL character.') };
    }
    const code = ch.codePointAt(0)!;
    if (code <= 0x1f) {
      return { res: errResult(reqId, 'navigate_bad_url', 'URL contains a control character.') };
    }
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { res: errResult(reqId, 'navigate_bad_url', `Unparseable URL: ${JSON.stringify(raw.slice(0, 200))}`) };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return {
      res: errResult(
        reqId,
        'navigate_bad_url',
        `URL scheme ${url.protocol} is not allowed; only plain http:// or https:// URLs can be navigated to.`,
      ),
    };
  }
  if (url.username !== '' || url.password !== '') {
    return {
      res: errResult(reqId, 'navigate_bad_url', 'URL contains embedded credentials (user:pass@), which are not allowed.'),
    };
  }
  return { url, raw };
}

/** Display-truncate the full URL for the approval card (400 chars, spec §3.4). */
function displayUrl(url: string): string {
  return url.length > 400 ? `${url.slice(0, 397)}…` : url;
}

async function routeNavigate(req: ToolCallRequest, grant: Grant, tab: chrome.tabs.Tab): Promise<ToolResult> {
  const reqId = req.id;
  const grantId = grant.grantId;
  const tabId = grant.tabId;

  // Capability gate (spec §3.2): act mode AND the explicit Allow Navigate flag.
  if (grant.mode !== 'act') {
    return errResult(
      reqId,
      'observe_only',
      'Navigation requires an act grant. Re-grant the tab with "Allow actions" checked, then enable "Allow Navigate".',
    );
  }
  if (grant.allowNavigate !== true) {
    return errResult(
      reqId,
      'navigate_not_allowed',
      'Navigation is not authorized for this grant — the user has not enabled "Allow Navigate".',
    );
  }

  // URL validation (spec §3.1) — before the user is asked.
  const validated = validateNavigateUrl(reqId, req.params['url']);
  if ('res' in validated) return validated.res;
  const dest = validated.url;
  const requestedUrl = dest.href;
  const crossOrigin = dest.origin !== grant.origin;

  // Fragment-only navigations to the current page are rejected (spec §3.3.1):
  // same document, only the in-page anchor changes — there is nothing to load,
  // and the load-wait would just time out on a no-op. (An exact same-URL
  // dispatch is NOT fragment-only; the spec does not reject it — it reloads.
  // Flagged as a known behavior, not a defect.)
  if (tab.url) {
    let current: URL | null = null;
    try {
      current = new URL(tab.url);
    } catch {
      current = null; // non-URL tab.url (e.g. devtools): let the normal path decide
    }
    if (
      current &&
      current.origin === dest.origin &&
      current.pathname === dest.pathname &&
      current.search === dest.search &&
      current.hash !== dest.hash
    ) {
      return errResult(
        reqId,
        'navigate_bad_url',
        'Fragment-only navigation to the current page is not allowed — tab_navigate changes the page, not the in-page anchor.',
      );
    }
  }

  // In-flight serialize (decision 6): one navigate at a time per grant.
  if (inFlightNavigates.has(grantId)) {
    return errResult(reqId, 'busy', 'Another tab_navigate for this grant is already in flight. Wait for it to finish, then retry.');
  }
  inFlightNavigates.add(grantId);

  try {
    // Approval gate (spec §3.4): SAME-ORIGIN never pauses — the origin pin is
    // unchanged, so there is no new boundary for the user to consent to.
    // CROSS-ORIGIN always pauses: Freaky mode does NOT bypass a new origin.
    const freshGrant = await getGrant(grantId);
    const skipApproval = !crossOrigin;
    const stepDetail = crossOrigin
      ? `a DIFFERENT origin. This suspends the grant for ${grant.origin}; the user must re-confirm on ${dest.origin} to continue.`
      : undefined;
    const cardUrl = displayUrl(requestedUrl);
    if (skipApproval) {
      // Same-origin: no approval needed (Freaky or not).
      if (freshGrant?.autoApprove === true && freshGrant.mode === 'act') {
        await appendAudit({
          type: 'action_auto_approved',
          grantId,
          tabId,
          tool: req.tool,
          detail: `navigate ${cardUrl} (same-origin, auto-approved)`,
        });
      } else {
        await appendAudit({
          type: 'action_proposed',
          grantId,
          tabId,
          tool: req.tool,
          detail: `navigate ${cardUrl} (same-origin, no approval needed)`,
        });
      }
    } else {
      await appendAudit({
        type: 'action_proposed',
        grantId,
        tabId,
        tool: req.tool,
        detail: `navigate ${cardUrl}`,
      });
      const opId = crypto.randomUUID();
      const decision = await proposeApproval({
        opId,
        steps: [{ kind: 'navigate', target: cardUrl, detail: stepDetail }],
        origin: grant.origin,
      });
      if (decision === 'busy') {
        return errResult(reqId, 'busy', "Another action is already awaiting the user's decision.");
      }
      if (decision === 'denied') {
        await appendAudit({ type: 'action_denied', grantId, tabId, tool: req.tool, detail: `navigate ${cardUrl}` });
        return errResult(reqId, 'approval_denied', `The user declined to navigate to ${cardUrl}.`);
      }
      if (decision === 'timeout') {
        await appendAudit({ type: 'action_timeout', grantId, tabId, tool: req.tool, detail: `navigate ${cardUrl}` });
        return errResult(reqId, 'approval_timeout', 'No user decision within the approval window.');
      }
      await appendAudit({ type: 'action_approved', grantId, tabId, tool: req.tool, detail: `navigate ${cardUrl}` });
      // The approval wait can last minutes: re-validate everything before dispatch.
      const revalidated = await validateGrantForCall(reqId, grantId);
      if ('res' in revalidated) return revalidated.res;
    }

    // Re-validate before dispatch (spec §3.3.1 — BOTH branches, act + Freaky).
    const preDispatch = await validateGrantForCall(reqId, grantId);
    if ('res' in preDispatch) return preDispatch.res;

    // Audit BEFORE dispatch: the JSONL alone must answer "did it navigate?"
    // (SW death mid-wait then leaves an audited dispatch with no completion).
    await appendAudit({
      type: 'navigate_dispatched',
      grantId,
      tabId,
      tool: req.tool,
      detail: `${requestedUrl} (crossOrigin: ${crossOrigin}, skipApproval: ${skipApproval})`,
    });

    // Dispatch. NO retry after tabs.update (C-11).
    // The load-wait listener is registered BEFORE the dispatch so the event
    // cannot fire before the listener exists (the spec's cleanup invariant
    // requires the listener to be in place when onUpdated fires).
    const waitPromise = waitTabLoad(tabId, preDispatch.tab.url);
    try {
      await chrome.tabs.update(tabId, { url: requestedUrl });
    } catch (error) {
      // Dispatch failed: the load-wait will time out (30 s) but we return
      // immediately. The listener is cleaned up by the timeout path.
      await appendAudit({
        type: 'navigate_completed',
        grantId,
        tabId,
        tool: req.tool,
        ok: false,
        detail: `dispatch failed: ${String(error)}`,
      });
      return errResult(reqId, 'tab_unreachable', `Navigation dispatch failed: ${String(error)}`);
    }

    // Load-wait (spec §3.3.5): one-shot onUpdated, 30 s timeout, cleanup
    // invariant — exactly one of {complete, timeout} wins.
    const wait = await waitPromise;
    // Final URL: the wait's observed URL when it has one; otherwise read the
    // tab's current URL (covers the timeout case, where a page that never
    // reports a load-complete may still have a URL — or a chrome-error URL).
    let finalUrl = wait.finalUrl;
    if (finalUrl === undefined) {
      finalUrl = (await chrome.tabs.get(tabId).then((t) => t.url).catch(() => undefined)) ?? requestedUrl;
    }

    // Post-load re-validation (spec §3.3.6): NOT raw tabs.get — raw get races
    // the pin listener and lets the receipt overclaim.
    //   - tab gone            -> grant_revoked error (the grant no longer exists);
    //   - grant suspended     -> OK receipt with grantStatus 'suspended' (the
    //     navigation really happened — that is the point; the user re-confirms);
    //   - grant still active  -> OK receipt with grantStatus 'active'.
    const post = await validateGrantForCall(reqId, grantId);
    // Attribution (spec §3.3.7), shared by the active AND suspended receipts:
    // 'timeout' if the load-wait timed out; 'conflict' if the final URL was
    // never observed as a changeInfo.url during this wait (another navigation
    // landed here); otherwise 'complete'. A conflict that lands off-origin is
    // therefore conflict + suspended (F7) — never laundered as a clean load.
    const loadState: NavigateResult['loadState'] =
      wait.loadState === 'timeout'
        ? 'timeout'
        : finalUrl !== requestedUrl && !wait.observedUrls.includes(finalUrl)
          ? 'conflict'
          : 'complete';
    const conflictNote =
      loadState === 'conflict' ? ', conflict: final URL was not loaded by this call' : '';
    if ('res' in post && post.res.ok === false) {
      if (post.res.error.code === 'grant_revoked') {
        // The tab itself is gone: the grant was revoked during the load-wait.
        // Audit the completion honestly, then surface the revocation (F2: the
        // navigate events still carry grantId for the forensic join).
        await appendAudit({
          type: 'navigate_completed',
          grantId,
          tabId,
          tool: req.tool,
          ok: false,
          detail: `tab closed during load-wait (finalUrl: ${finalUrl}); grant revoked`,
        });
        return post.res;
      }
      // grant_suspended (cross-origin destination / off-origin redirect /
      // chrome-error): the navigation happened; report it as a suspended receipt.
      const result: NavigateResult = { requestedUrl, finalUrl, loadState, grantStatus: 'suspended' };
      await appendAudit({
        type: 'navigate_completed',
        grantId,
        tabId,
        tool: req.tool,
        detail: `${requestedUrl} -> ${finalUrl} (loadState: ${loadState}, grantStatus: suspended${conflictNote})`,
      });
      return okResult(reqId, result);
    }

    // Grant still active (same-origin, incl. same-origin redirect chain).
    const result: NavigateResult = { requestedUrl, finalUrl, loadState, grantStatus: 'active' };
    await appendAudit({
      type: 'navigate_completed',
      grantId,
      tabId,
      tool: req.tool,
      detail: `${requestedUrl} -> ${finalUrl} (loadState: ${loadState}, grantStatus: active${conflictNote})`,
    });
    return okResult(reqId, result);
  } finally {
    inFlightNavigates.delete(grantId);
  }
}
