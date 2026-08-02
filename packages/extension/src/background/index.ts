// Background service worker — wires the native port, the tool-call router,
// grant lifecycle listeners (origin pin, tab close) and the side-panel API.
//
// Permission note: the 'tabs' permission is required because the background
// must read the granted tab's url/title OUTSIDE of any user-gesture context
// (origin-pin checks in tabs.onUpdated and on every toolCall). activeTab alone
// only covers gesture-scoped access. Accepted for Stage 1; no install-time
// host_permissions — the side panel requests the granted origin at runtime
// (optional_host_permissions) and teardown paths drop it again.
import type { Grant, GrantMode } from '@ctr/shared';
import { ToolCallRequestSchema } from '@ctr/shared';
import { decideApproval, getPendingApproval, setApprovalNotifier } from './approvals.js';
import {
  dismissGrantRequest,
  getPendingGrantRequest,
  grantRequestGranted,
  setGrantRequestNotifier,
} from './grant-requests.js';
import {
  clearApprovalNotification,
  clearGrantRequestNotification,
  setAttentionBadge,
  showApprovalNotification,
  showGrantRequestNotification,
  wireNotificationClicks,
} from './notifications.js';
import { appendAudit, getAudit, setAuditForwarder } from './audit.js';
import {
  getGrant,
  listGrants,
  mintGrant,
  reconfirmGrant,
  revokeGrant,
  revokeGrantsForTab,
  setAutoApprove,
  suspendGrant,
} from './grant-store.js';
import { connectNativeHost, getNativeStatus, sendToHost } from './native-port.js';
import { dropOriginPermission } from './origin-permission.js';
import { handleToolCall } from './router.js';

// Toolbar icon opens the side panel.
void chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(() => undefined);

// Every audit entry is forwarded to the host for JSONL persistence AND pushes a
// panel refresh so the audit view never lags behind reality.
setAuditForwarder((entry) => {
  sendToHost({ kind: 'audit', entry });
  notifySidePanel();
});

function notifySidePanel(): void {
  // No listener when the side panel is closed — ignore the rejection.
  void chrome.runtime.sendMessage({ type: 'ctrStateChanged' }).catch(() => undefined);
}

// Approval / request transitions: re-render the panel AND raise out-of-panel
// attention (system notification + toolbar badge) — the gate must work even
// when the side panel is not visible.
function updateAttention(): void {
  const approval = getPendingApproval();
  const request = getPendingGrantRequest();
  setAttentionBadge(!!approval || !!request);
  if (approval) {
    const summary = approval.steps
      .map((s) => `${s.kind} ${s.target}${s.detail ? ` (${s.detail})` : ''}`)
      .join('; ');
    showApprovalNotification(summary, approval.origin);
  } else {
    clearApprovalNotification();
  }
  if (request) {
    showGrantRequestNotification(request.reason, request.requestedMode);
  } else {
    clearGrantRequestNotification();
  }
}

setApprovalNotifier(() => {
  notifySidePanel();
  updateAttention();
});
setGrantRequestNotifier(() => {
  notifySidePanel();
  updateAttention();
});
// Notification click → jump to the granted tab (approvals live there).
wireNotificationClicks(async () => (await listGrants())[0]?.tabId);

async function broadcastGrants(): Promise<void> {
  const grants = await listGrants();
  sendToHost({ kind: 'grantsChanged', grants });
  notifySidePanel();
}

connectNativeHost({
  onMessage: (raw) => {
    const parsed = ToolCallRequestSchema.safeParse(raw);
    if (!parsed.success) return;
    void handleToolCall(parsed.data).then((result) => {
      sendToHost(result);
    });
  },
  onConnect: () => {
    void appendAudit({ type: 'native_connected' });
    void broadcastGrants();
  },
  onStatusChange: (status) => {
    if (status === 'disconnected') {
      void appendAudit({ type: 'native_disconnected' });
    }
    notifySidePanel();
  },
});

// --- Grant lifecycle -------------------------------------------------------

async function injectContentScript(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
}

function originOf(url: string | undefined): string | null {
  if (!url || !/^https?:/i.test(url)) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export type SidePanelResult =
  | { ok: true; grant?: Grant }
  | { ok: false; error: string };

async function grantActiveTab(tabId: number, mode: GrantMode): Promise<SidePanelResult> {
  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return { ok: false, error: 'Tab not found.' };
  }
  const origin = originOf(tab.url);
  if (!origin) {
    return { ok: false, error: 'Only http(s) pages can be granted.' };
  }
  const grant = await mintGrant(tabId, origin, Date.now(), mode);
  try {
    await injectContentScript(tabId);
  } catch (err) {
    await revokeGrant(grant.grantId);
    await dropOriginPermission(origin);
    return { ok: false, error: `Could not inject the content script into this tab. (${String(err)})` };
  }
  await appendAudit({ type: 'grant_created', grantId: grant.grantId, tabId, detail: `${origin} (${mode})` });
  // A fresh grant answers any pending agent access request.
  grantRequestGranted();
  await broadcastGrants();
  return { ok: true, grant };
}

async function revokeByUser(grantId: string): Promise<SidePanelResult> {
  const revoked = await revokeGrant(grantId);
  if (!revoked) return { ok: false, error: 'No such grant.' };
  await dropOriginPermission(revoked.origin);
  await appendAudit({ type: 'grant_revoked', grantId, tabId: revoked.tabId, detail: 'revoked by user' });
  await broadcastGrants();
  return { ok: true };
}

/**
 * Re-confirm a suspended grant. `expectedOrigin` is the origin the side panel
 * DISPLAYED to the user when they clicked — the re-pin only happens if the
 * tab's origin still matches it (informed consent; closes the render-to-click
 * TOCTOU window where the tab could navigate again).
 */
async function reconfirmByUser(grantId: string, expectedOrigin: string): Promise<SidePanelResult> {
  const grant = await getGrant(grantId);
  if (!grant) return { ok: false, error: 'No such grant.' };
  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(grant.tabId);
  } catch {
    await revokeGrant(grantId);
    await dropOriginPermission(grant.origin);
    await appendAudit({ type: 'grant_revoked', grantId, tabId: grant.tabId, detail: 'tab gone at re-confirm' });
    await broadcastGrants();
    return { ok: false, error: 'The granted tab no longer exists.' };
  }
  const origin = originOf(tab.url);
  if (!origin) {
    return { ok: false, error: 'Current page cannot be granted (not http/https).' };
  }
  if (origin !== expectedOrigin) {
    return { ok: false, error: 'Tab origin changed since you reviewed it — check again.' };
  }
  const updated = await reconfirmGrant(grantId, origin);
  // Re-pinned to a new origin: the old origin's runtime permission is obsolete.
  if (grant.origin !== origin) await dropOriginPermission(grant.origin);
  try {
    await injectContentScript(grant.tabId);
  } catch (err) {
    return { ok: false, error: `Could not re-inject the content script. (${String(err)})` };
  }
  await appendAudit({ type: 'grant_reconfirmed', grantId, tabId: grant.tabId, detail: origin });
  await broadcastGrants();
  return { ok: true, grant: updated };
}

// Origin pin: navigation to a different origin suspends the grant.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  const url = changeInfo.url;
  if (!url) return;
  void (async () => {
    const grants = await listGrants();
    const grant = grants.find((g) => g.tabId === tabId && g.status === 'active');
    if (!grant) return;
    let origin = '';
    try {
      origin = new URL(url).origin;
    } catch {
      origin = '';
    }
    if (origin === grant.origin) return;
    await suspendGrant(grant.grantId);
    await appendAudit({
      type: 'grant_suspended',
      grantId: grant.grantId,
      tabId,
      detail: `navigated to ${origin || 'unknown origin'}`,
    });
    await broadcastGrants();
  })();
});

// Tab close revokes.
chrome.tabs.onRemoved.addListener((tabId) => {
  void (async () => {
    const removed = await revokeGrantsForTab(tabId);
    for (const grant of removed) {
      await dropOriginPermission(grant.origin);
      await appendAudit({ type: 'grant_revoked', grantId: grant.grantId, tabId, detail: 'tab closed' });
    }
    if (removed.length > 0) await broadcastGrants();
  })();
});

// --- Side panel API --------------------------------------------------------

interface SidePanelMessage {
  type?: string;
  tabId?: number;
  grantId?: string;
  /** ctrGrantActiveTab only: 'observe' (default) or 'act'. */
  mode?: string;
  /** ctrReconfirm only: the origin the side panel showed the user. */
  expectedOrigin?: string;
  /** ctrApprove / ctrDeny only. */
  opId?: string;
  /** ctrSetAutoApprove only. */
  enabled?: boolean;
}

chrome.runtime.onMessage.addListener(
  (msg: unknown, _sender, sendResponse: (response: unknown) => void) => {
    const m = (msg ?? {}) as SidePanelMessage;
    switch (m.type) {
      case 'ctrGetState':
        void (async () => {
          const grants = await listGrants();
          // Title of the granted tab, so the panel can name it when the user
          // is looking at a DIFFERENT tab ("granted elsewhere").
          let grantedTab: { id: number; title: string } | null = null;
          if (grants[0]) {
            try {
              const tab = await chrome.tabs.get(grants[0].tabId);
              grantedTab = { id: grants[0].tabId, title: tab.title ?? '' };
            } catch {
              grantedTab = null;
            }
          }
          sendResponse({
            grants,
            nativeStatus: getNativeStatus(),
            pendingApproval: getPendingApproval(),
            pendingGrantRequest: getPendingGrantRequest(),
            grantedTab,
          });
        })();
        return true;
      case 'ctrDismissGrantRequest':
        sendResponse({ ok: dismissGrantRequest() });
        return false;
      case 'ctrGrantActiveTab':
        if (typeof m.tabId !== 'number') {
          sendResponse({ ok: false, error: 'Missing tabId.' });
          return false;
        }
        void grantActiveTab(m.tabId, m.mode === 'act' ? 'act' : 'observe').then(sendResponse);
        return true;
      case 'ctrSetAutoApprove':
        if (typeof m.grantId !== 'string' || typeof m.enabled !== 'boolean') {
          sendResponse({ ok: false, error: 'Missing grantId or enabled.' });
          return false;
        }
        void (async () => {
          const enabled = m.enabled === true;
          const updated = await setAutoApprove(m.grantId as string, enabled);
          if (!updated) {
            sendResponse({ ok: false, error: 'No act grant with this id.' });
            return;
          }
          await appendAudit({
            type: enabled ? 'auto_approve_enabled' : 'auto_approve_disabled',
            grantId: updated.grantId,
            tabId: updated.tabId,
            detail: enabled ? 'Freaky mode ON — actions run without asking' : 'per-action approval restored',
          });
          await broadcastGrants();
          sendResponse({ ok: true });
        })();
        return true;
      case 'ctrApprove':
      case 'ctrDeny':
        if (typeof m.opId !== 'string') {
          sendResponse({ ok: false, error: 'Missing opId.' });
          return false;
        }
        sendResponse({ ok: decideApproval(m.opId, m.type === 'ctrApprove') });
        return false;
      case 'ctrRevoke':
        if (typeof m.grantId !== 'string') {
          sendResponse({ ok: false, error: 'Missing grantId.' });
          return false;
        }
        void revokeByUser(m.grantId).then(sendResponse);
        return true;
      case 'ctrReconfirm':
        if (typeof m.grantId !== 'string' || typeof m.expectedOrigin !== 'string') {
          sendResponse({ ok: false, error: 'Missing grantId or expectedOrigin.' });
          return false;
        }
        void reconfirmByUser(m.grantId, m.expectedOrigin).then(sendResponse);
        return true;
      case 'ctrGetAudit':
        // 100, not 20: the panel filters per-tab, so it needs headroom to still
        // show up to 20 entries for the active tab.
        void getAudit(100).then((entries) => sendResponse({ entries }));
        return true;
      default:
        return false;
    }
  },
);
