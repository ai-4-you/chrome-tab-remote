// Side panel — grant management + audit trail. Vanilla TS, no framework.
// Talks to the background via chrome.runtime messages; listens for
// 'ctrStateChanged' pushes and keeps a 1s tick for the expiry countdown.
import type { AuditEntry, Grant } from '@ctr/shared';

interface StateResponse {
  grants: Grant[];
  nativeStatus: 'connected' | 'disconnected';
}

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}

const els = {
  nativeStatus: $('native-status'),
  tabTitle: $('current-tab-title'),
  tabOrigin: $('current-tab-origin'),
  grantBtn: $('grant-btn') as HTMLButtonElement,
  grantError: $('grant-error'),
  grantSection: $('grant-section'),
  grantOrigin: $('grant-origin'),
  grantStatus: $('grant-status'),
  grantExpiry: $('grant-expiry'),
  reconfirmBtn: $('reconfirm-btn') as HTMLButtonElement,
  revokeBtn: $('revoke-btn') as HTMLButtonElement,
  auditList: $('audit-list'),
};

let state: StateResponse = { grants: [], nativeStatus: 'disconnected' };
let currentTab: chrome.tabs.Tab | null = null;
/**
 * Origin the GRANTED tab currently shows while the grant is suspended — the
 * origin a re-confirm would re-pin to. Displayed on the button and sent as
 * `expectedOrigin` so the background can reject if it changed after render.
 */
let pendingOrigin: string | null = null;

function originOf(url: string | undefined): string | null {
  if (!url || !/^https?:/i.test(url)) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

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

function renderGrant(): void {
  const grant = activeGrant();
  if (!grant) {
    els.grantSection.classList.add('hidden');
    return;
  }
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
}

function renderAudit(entries: AuditEntry[]): void {
  els.auditList.replaceChildren(
    ...entries.map((entry) => {
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
  renderNativeStatus();
  renderCurrentTab();
  renderGrant();
  renderAudit(audit.entries.slice(0, 20));
}

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
    })) as { ok: boolean; error?: string };
    if (!res.ok) showError(res.error ?? 'Grant failed.');
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

// 1s tick: countdown + expiry flip without waiting for a push.
setInterval(() => {
  renderGrant();
}, 1000);

void refresh();
