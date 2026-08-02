// Side panel — grant management + audit trail. Vanilla TS, no framework.
// Talks to the background via chrome.runtime messages; listens for
// 'ctrStateChanged' pushes and keeps a 1s tick for the expiry countdown.
import type { AuditEntry, Grant } from '@ctr/shared';
import { originOf } from '@ctr/shared';

interface PendingApproval {
  opId: string;
  steps: { kind: 'click' | 'fill' | 'select'; target: string; detail?: string }[];
  origin: string;
  deadline: number;
}

interface PendingGrantRequest {
  reason?: string;
  requestedMode: 'observe' | 'act';
  deadline: number;
}

interface StateResponse {
  grants: Grant[];
  nativeStatus: 'connected' | 'disconnected';
  /** This browser's MCP endpoint (ports differ per browser); null while disconnected. */
  mcpUrl: string | null;
  pendingApproval: PendingApproval | null;
  pendingGrantRequest: PendingGrantRequest | null;
  /** id + title of the granted tab (null when no grant or its tab is gone). */
  grantedTab: { id: number; title: string } | null;
}

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}

const els = {
  nativeStatus: $('native-status'),
  mcpUrl: $('mcp-url'),
  tabTitle: $('current-tab-title'),
  tabOrigin: $('current-tab-origin'),
  tabShareStatus: $('tab-share-status'),
  actMode: $('act-mode') as HTMLInputElement,
  grantBtn: $('grant-btn') as HTMLButtonElement,
  grantError: $('grant-error'),
  grantSection: $('grant-section'),
  grantOrigin: $('grant-origin'),
  grantStatus: $('grant-status'),
  grantExpiry: $('grant-expiry'),
  reconfirmBtn: $('reconfirm-btn') as HTMLButtonElement,
  revokeBtn: $('revoke-btn') as HTMLButtonElement,
  freakyRow: $('freaky-row'),
  freakyToggle: $('freaky-toggle') as HTMLInputElement,
  elsewhereSection: $('elsewhere-section'),
  elsewhereFreaky: $('elsewhere-freaky'),
  elsewhereTitle: $('elsewhere-title'),
  elsewhereOrigin: $('elsewhere-origin'),
  elsewhereExpiry: $('elsewhere-expiry'),
  gotoGrantedBtn: $('goto-granted-btn') as HTMLButtonElement,
  elsewhereRevokeBtn: $('elsewhere-revoke-btn') as HTMLButtonElement,
  approvalSection: $('approval-section'),
  approvalText: $('approval-text'),
  approvalDetail: $('approval-detail'),
  approvalCountdown: $('approval-countdown'),
  approveBtn: $('approve-btn') as HTMLButtonElement,
  denyBtn: $('deny-btn') as HTMLButtonElement,
  approvalGotoBtn: $('approval-goto-btn') as HTMLButtonElement,
  requestSection: $('request-section'),
  requestMode: $('request-mode'),
  requestReason: $('request-reason'),
  requestHint: $('request-hint'),
  requestCountdown: $('request-countdown'),
  requestDismissBtn: $('request-dismiss-btn') as HTMLButtonElement,
  auditAll: $('audit-all') as HTMLInputElement,
  auditEmpty: $('audit-empty'),
  auditList: $('audit-list'),
};

let state: StateResponse = {
  grants: [],
  nativeStatus: 'disconnected',
  mcpUrl: null,
  pendingApproval: null,
  pendingGrantRequest: null,
  grantedTab: null,
};
let lastAudit: AuditEntry[] = [];
let currentTab: chrome.tabs.Tab | null = null;
/**
 * Origin the GRANTED tab currently shows while the grant is suspended — the
 * origin a re-confirm would re-pin to. Displayed on the button and sent as
 * `expectedOrigin` so the background can reject if it changed after render.
 */
let pendingOrigin: string | null = null;

function activeGrant(): Grant | undefined {
  return state.grants[0];
}

function showError(message: string): void {
  els.grantError.textContent = message;
  els.grantError.classList.remove('hidden');
}

function clearError(): void {
  els.grantError.textContent = '';
  els.grantError.classList.add('hidden');
}

function formatCountdown(expiresAt: string): string {
  const remaining = Date.parse(expiresAt) - Date.now();
  if (remaining <= 0) return 'expired';
  const totalSec = Math.floor(remaining / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `in ${min}:${String(sec).padStart(2, '0')} min`;
}

function renderNativeStatus(): void {
  const connected = state.nativeStatus === 'connected';
  els.nativeStatus.textContent = connected ? 'connected' : 'disconnected';
  els.nativeStatus.className = `badge ${connected ? 'badge-ok' : 'badge-off'}`;
  // Where agents connect — ports differ per browser, so show it right here.
  els.mcpUrl.textContent = state.mcpUrl ? `MCP: ${state.mcpUrl}` : '';
}

function renderCurrentTab(): void {
  els.tabTitle.textContent = currentTab?.title ?? '—';
  let origin = '—';
  try {
    origin = currentTab?.url ? new URL(currentTab.url).origin : '—';
  } catch {
    origin = '—';
  }
  els.tabOrigin.textContent = origin;
  els.grantBtn.disabled = !currentTab || !/^https?:/i.test(currentTab.url ?? '');
}

/** True when the tab the user is LOOKING AT is the granted one. */
function onGrantedTab(): boolean {
  const grant = activeGrant();
  return !!grant && currentTab?.id === grant.tabId;
}

/**
 * Tab-scoped rendering (G-9): the panel always describes the ACTIVE tab.
 * The grant card only appears on the granted tab; on every other tab an
 * unmistakable "granted on another tab" card carries the cross-reference.
 */
function renderGrant(): void {
  const grant = activeGrant();

  // Share-status line + grant button label for THIS tab.
  const mode = els.actMode.checked ? 'observe + act' : 'observe';
  if (!grant) {
    els.tabShareStatus.textContent = 'Not shared — the agent cannot see any tab.';
    els.grantBtn.textContent = `Grant ${mode} access (30 min)`;
  } else if (onGrantedTab()) {
    els.tabShareStatus.textContent = 'Shared with the agent (see grant below).';
    els.grantBtn.textContent = `Replace grant (${mode}, new 30 min)`;
  } else {
    els.tabShareStatus.textContent = 'This tab is NOT shared with the agent.';
    els.grantBtn.textContent = `Replace grant with this tab (${mode}, 30 min)`;
  }

  // Grant card: only on the granted tab.
  if (!grant || !onGrantedTab()) {
    els.grantSection.classList.add('hidden');
  } else {
    els.grantSection.classList.remove('hidden');
    els.grantOrigin.textContent = grant.origin;
    const expired = Date.parse(grant.expiresAt) <= Date.now();
    const statusText = expired ? 'expired' : grant.status;
    els.grantStatus.textContent = statusText;
    els.grantStatus.className = `badge ${
      statusText === 'active' ? 'badge-ok' : statusText === 'suspended' ? 'badge-warn' : 'badge-off'
    }`;
    els.grantExpiry.textContent = formatCountdown(grant.expiresAt);
    const suspended = grant.status === 'suspended' && !expired;
    els.reconfirmBtn.classList.toggle('hidden', !suspended);
    // Informed consent: show exactly which origin a re-confirm would re-pin to.
    els.reconfirmBtn.textContent = pendingOrigin ? `Re-confirm for ${pendingOrigin}` : 'Re-confirm';
    els.reconfirmBtn.disabled = suspended && !pendingOrigin;
    // Freaky mode: act grants only, live-toggleable while the agent works.
    els.freakyRow.classList.toggle('hidden', grant.mode !== 'act');
    els.freakyToggle.checked = grant.autoApprove === true;
  }

  // "Granted on another tab" card: only when a grant exists elsewhere.
  if (!grant || onGrantedTab()) {
    els.elsewhereSection.classList.add('hidden');
  } else {
    els.elsewhereSection.classList.remove('hidden');
    els.elsewhereTitle.textContent = state.grantedTab?.title || grant.origin;
    els.elsewhereOrigin.textContent = `${grant.origin} (${grant.mode})`;
    els.elsewhereExpiry.textContent = `Expires ${formatCountdown(grant.expiresAt)}`;
    els.elsewhereFreaky.classList.toggle('hidden', grant.autoApprove !== true);
  }
}

/** Jump to the granted tab (and focus its window). */
function goToGrantedTab(): void {
  const grant = activeGrant();
  if (!grant) return;
  void (async () => {
    try {
      const tab = await chrome.tabs.update(grant.tabId, { active: true });
      if (tab?.windowId !== undefined) {
        await chrome.windows.update(tab.windowId, { focused: true });
      }
    } catch {
      showError('The granted tab could not be focused (already closed?).');
    }
  })();
}

function renderApproval(): void {
  const pending = state.pendingApproval;
  if (!pending) {
    els.approvalSection.classList.add('hidden');
    return;
  }
  els.approvalSection.classList.remove('hidden');
  const n = pending.steps.length;
  els.approvalText.textContent =
    n === 1
      ? `Agent wants one action on ${pending.origin}:`
      : `Agent wants a plan of ${n} actions on ${pending.origin} (approved as a whole, executed in order):`;
  els.approvalDetail.textContent = pending.steps
    .map((s, i) => `${i + 1}. ${s.kind} ${s.target}${s.detail ? ` — ${s.detail}` : ''}`)
    .join('\n');
  const secondsLeft = Math.max(0, Math.floor((pending.deadline - Date.now()) / 1000));
  els.approvalCountdown.textContent = `Auto-deny in ${secondsLeft}s`;
}

function renderGrantRequest(): void {
  const request = state.pendingGrantRequest;
  if (!request) {
    els.requestSection.classList.add('hidden');
    return;
  }
  els.requestSection.classList.remove('hidden');
  const act = request.requestedMode === 'act';
  // Structured + color-coded by requested capability: act requests are loud.
  els.requestSection.classList.toggle('request-act', act);
  els.requestMode.textContent = act
    ? '⚡ OBSERVE + ACT requested — the agent wants to click/fill (each action still needs your approval)'
    : '👁 OBSERVE requested — read-only access';
  els.requestMode.className = `request-mode ${act ? 'request-mode-act' : 'request-mode-observe'}`;
  els.requestReason.textContent = request.reason ? `Reason: ${request.reason}` : 'No reason given.';
  els.requestHint.textContent = act
    ? 'Open the tab you want to share, TICK "allow actions", then click Grant — or dismiss. Granting observe-only instead is also a valid answer.'
    : 'Open the tab you want to share, then click Grant — or dismiss.';
  const secondsLeft = Math.max(0, Math.floor((request.deadline - Date.now()) / 1000));
  els.requestCountdown.textContent = `Expires in ${secondsLeft}s`;
}

/**
 * Per-tab audit view (G-9): default shows only entries stamped with the ACTIVE
 * tab's id; "show all" reveals every tab plus system events (which carry no
 * tabId). The host JSONL always keeps the complete global ledger.
 */
function renderAudit(entries: AuditEntry[]): void {
  const filtered = els.auditAll.checked
    ? entries
    : entries.filter((entry) => entry.tabId !== undefined && entry.tabId === currentTab?.id);
  els.auditEmpty.classList.toggle('hidden', filtered.length > 0);
  els.auditList.replaceChildren(
    ...filtered.slice(0, 20).map((entry) => {
      const li = document.createElement('li');
      const time = document.createElement('span');
      time.className = 'audit-time';
      time.textContent = new Date(entry.ts).toLocaleTimeString();
      const type = document.createElement('span');
      type.className = `audit-type${entry.ok === false ? ' audit-fail' : ''}`;
      type.textContent = entry.tool ? `${entry.type}:${entry.tool}` : entry.type;
      const detail = document.createElement('span');
      detail.className = 'audit-detail';
      detail.textContent = entry.detail ?? '';
      li.append(time, type, detail);
      return li;
    }),
  );
}

async function refresh(): Promise<void> {
  try {
    await refreshUnsafe();
  } catch (error) {
    // The background SW may be restarting mid-push; keep the last rendered
    // state instead of dying on an unhandled rejection. The next push or tick
    // will refresh again.
    console.warn('[chrome-tab-remote] panel refresh failed (SW restarting?):', error);
  }
}

async function refreshUnsafe(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab ?? null;
  state = (await chrome.runtime.sendMessage({ type: 'ctrGetState' })) as StateResponse;
  const audit = (await chrome.runtime.sendMessage({ type: 'ctrGetAudit' })) as {
    entries: AuditEntry[];
  };
  const grant = activeGrant();
  pendingOrigin = null;
  if (grant && grant.status === 'suspended') {
    try {
      // The GRANTED tab (not the active one) — its current origin is what a
      // re-confirm would re-pin to.
      const grantedTab = await chrome.tabs.get(grant.tabId);
      pendingOrigin = originOf(grantedTab.url);
    } catch {
      pendingOrigin = null;
    }
  }
  lastAudit = audit.entries;
  renderNativeStatus();
  renderCurrentTab();
  renderGrant();
  renderApproval();
  renderGrantRequest();
  renderAudit(lastAudit);
}

// Mode checkbox changes the grant/replace button label (rendered in renderGrant).
els.actMode.addEventListener('change', renderGrant);
// Toggling "show all" re-filters the already-loaded audit entries.
els.auditAll.addEventListener('change', () => renderAudit(lastAudit));

els.grantBtn.addEventListener('click', () => {
  void (async () => {
    clearError();
    if (!currentTab?.id) {
      showError('No active tab.');
      return;
    }
    const origin = originOf(currentTab.url);
    if (!origin) {
      showError('Only http(s) pages can be granted.');
      return;
    }
    // Runtime host permission for exactly this origin, requested inside the
    // user's click gesture (required for injection: no install-time
    // host_permissions, and activeTab does not cover side-panel clicks).
    const permitted = await chrome.permissions.request({ origins: [`${origin}/*`] });
    if (!permitted) {
      showError('Chrome permission for this site was declined.');
      return;
    }
    const res = (await chrome.runtime.sendMessage({
      type: 'ctrGrantActiveTab',
      tabId: currentTab.id,
      mode: els.actMode.checked ? 'act' : 'observe',
    })) as { ok: boolean; error?: string };
    if (!res.ok) showError(res.error ?? 'Grant failed.');
    await refresh();
  })();
});

function decide(type: 'ctrApprove' | 'ctrDeny'): void {
  void (async () => {
    const pending = state.pendingApproval;
    if (!pending) return;
    await chrome.runtime.sendMessage({ type, opId: pending.opId });
    await refresh();
  })();
}

els.freakyToggle.addEventListener('change', () => {
  void (async () => {
    const grant = activeGrant();
    if (!grant) return;
    const res = (await chrome.runtime.sendMessage({
      type: 'ctrSetAutoApprove',
      grantId: grant.grantId,
      enabled: els.freakyToggle.checked,
    })) as { ok: boolean; error?: string };
    if (!res.ok) showError(res.error ?? 'Could not change Freaky mode.');
    await refresh();
  })();
});

els.approveBtn.addEventListener('click', () => decide('ctrApprove'));
els.denyBtn.addEventListener('click', () => decide('ctrDeny'));
els.approvalGotoBtn.addEventListener('click', goToGrantedTab);
els.gotoGrantedBtn.addEventListener('click', goToGrantedTab);
els.elsewhereRevokeBtn.addEventListener('click', () => {
  void (async () => {
    const grant = activeGrant();
    if (!grant) return;
    await chrome.runtime.sendMessage({ type: 'ctrRevoke', grantId: grant.grantId });
    await refresh();
  })();
});

els.revokeBtn.addEventListener('click', () => {
  void (async () => {
    clearError();
    const grant = activeGrant();
    if (!grant) return;
    await chrome.runtime.sendMessage({ type: 'ctrRevoke', grantId: grant.grantId });
    await refresh();
  })();
});

els.reconfirmBtn.addEventListener('click', () => {
  void (async () => {
    clearError();
    const grant = activeGrant();
    if (!grant) return;
    if (!pendingOrigin) {
      showError('The granted tab shows a page that cannot be granted.');
      return;
    }
    // Same gesture-gated runtime permission as the initial grant, for the
    // origin the user is re-confirming to.
    const permitted = await chrome.permissions.request({ origins: [`${pendingOrigin}/*`] });
    if (!permitted) {
      showError('Chrome permission for this site was declined.');
      return;
    }
    const res = (await chrome.runtime.sendMessage({
      type: 'ctrReconfirm',
      grantId: grant.grantId,
      expectedOrigin: pendingOrigin,
    })) as { ok: boolean; error?: string };
    if (!res.ok) showError(res.error ?? 'Re-confirm failed.');
    await refresh();
  })();
});

// Push updates from the background.
chrome.runtime.onMessage.addListener((msg: unknown) => {
  if ((msg as { type?: string })?.type === 'ctrStateChanged') {
    void refresh();
  }
});

// Active-tab changes affect the "Current tab" card.
chrome.tabs.onActivated.addListener(() => void refresh());

els.requestDismissBtn.addEventListener('click', () => {
  void (async () => {
    await chrome.runtime.sendMessage({ type: 'ctrDismissGrantRequest' });
    await refresh();
  })();
});

// 1s tick: countdowns + expiry flip without waiting for a push.
setInterval(() => {
  renderGrant();
  renderApproval();
  renderGrantRequest();
}, 1000);

void refresh();
