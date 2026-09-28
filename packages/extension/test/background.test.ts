// Background side-panel API: re-confirm must be an INFORMED re-pin — the
// origin the panel displayed (expectedOrigin) has to match the granted tab's
// origin at click time, otherwise the re-pin is refused (TOCTOU protection).
import { beforeEach, describe, expect, it } from 'vitest';
import { installChromeMock } from './chrome-mock.js';

// The background script wires chrome.* listeners at import time, so the mock
// must be installed first.
const mock = installChromeMock();
const { getGrant, mintGrant, suspendGrant } = await import('../src/background/grant-store.js');
const { getAudit } = await import('../src/background/audit.js');
await import('../src/background/index.js');

const ORIGIN = 'https://intranet.corp.example';
const NEW_ORIGIN = 'https://evil.example.net';

function sendPanelMessage(msg: unknown): Promise<unknown> {
  return new Promise((resolve) => {
    mock.runtime.onMessage.emit(msg, {}, resolve);
  });
}

describe('toolbar action', () => {
  beforeEach(async () => {
    await mock.storage.session.clear();
    mock.sidePanel.open.mockClear();
  });

  it('opens the clicked tab window from an explicit action invocation', () => {
    mock.action.onClicked.emit({ windowId: 7 });
    expect(mock.sidePanel.open).toHaveBeenCalledWith({ windowId: 7 });
    expect(mock.sidePanel.setPanelBehavior).not.toHaveBeenCalled();
  });

  it('does nothing when the action callback has no window id', () => {
    mock.action.onClicked.emit({});
    expect(mock.sidePanel.open).not.toHaveBeenCalled();
  });

});

describe('ctrReconfirm (informed re-pin)', () => {
  beforeEach(async () => {
    await mock.storage.session.clear();
    mock.scripting.executeScript.mockClear();
    mock.scripting.executeScript.mockResolvedValue([]);
  });

  it('rejects when expectedOrigin is missing', async () => {
    const res = (await sendPanelMessage({ type: 'ctrReconfirm', grantId: 'g1' })) as {
      ok: boolean;
      error?: string;
    };
    expect(res.ok).toBe(false);
    expect(res.error).toContain('expectedOrigin');
  });

  it('refuses the re-pin when the tab origin changed after the user reviewed it', async () => {
    const grant = await mintGrant(1, ORIGIN);
    await suspendGrant(grant.grantId);
    // The tab moved on again between render and click.
    mock.tabs.get.mockResolvedValue({ id: 1, url: `${NEW_ORIGIN}/phish` });

    const res = (await sendPanelMessage({
      type: 'ctrReconfirm',
      grantId: grant.grantId,
      expectedOrigin: ORIGIN, // what the side panel showed
    })) as { ok: boolean; error?: string };

    expect(res.ok).toBe(false);
    expect(res.error).toContain('origin changed');
    const after = await getGrant(grant.grantId);
    expect(after?.status).toBe('suspended');
    expect(after?.origin).toBe(ORIGIN);
    expect(mock.scripting.executeScript).not.toHaveBeenCalled();
  });

  it('re-pins and re-injects when expectedOrigin matches the tab origin', async () => {
    const grant = await mintGrant(1, ORIGIN);
    await suspendGrant(grant.grantId);
    mock.tabs.get.mockResolvedValue({ id: 1, url: `${NEW_ORIGIN}/page` });

    const res = (await sendPanelMessage({
      type: 'ctrReconfirm',
      grantId: grant.grantId,
      expectedOrigin: NEW_ORIGIN, // panel showed the new origin; user confirmed it
    })) as { ok: boolean };

    expect(res.ok).toBe(true);
    const after = await getGrant(grant.grantId);
    expect(after?.status).toBe('active');
    expect(after?.origin).toBe(NEW_ORIGIN);
    expect(mock.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 1 },
      files: ['content.js'],
    });
    // Re-pinned to a new origin -> the old origin's runtime permission is dropped.
    expect(mock.permissions.remove).toHaveBeenCalledWith({ origins: [`${ORIGIN}/*`] });
  });
});

describe('runtime host permission teardown', () => {
  beforeEach(async () => {
    await mock.storage.session.clear();
    mock.permissions.remove.mockClear();
    mock.scripting.executeScript.mockResolvedValue([]);
  });

  it('drops the origin permission when the user revokes the grant', async () => {
    const grant = await mintGrant(1, ORIGIN);
    const res = (await sendPanelMessage({ type: 'ctrRevoke', grantId: grant.grantId })) as {
      ok: boolean;
    };
    expect(res.ok).toBe(true);
    expect(mock.permissions.remove).toHaveBeenCalledWith({ origins: [`${ORIGIN}/*`] });
  });

  it('drops the origin permission when the granted tab is closed', async () => {
    const grant = await mintGrant(7, ORIGIN);
    mock.tabs.onRemoved.emit(7);
    await new Promise((r) => setTimeout(r, 0)); // let the async listener run
    expect(await getGrant(grant.grantId)).toBeUndefined();
    expect(mock.permissions.remove).toHaveBeenCalledWith({ origins: [`${ORIGIN}/*`] });
  });

  it('drops the origin permission when injection fails at grant time', async () => {
    mock.tabs.get.mockResolvedValue({ id: 3, url: `${ORIGIN}/page` });
    mock.scripting.executeScript.mockRejectedValue(new Error('Cannot access contents of the page.'));
    const res = (await sendPanelMessage({ type: 'ctrGrantActiveTab', tabId: 3 })) as {
      ok: boolean;
      error?: string;
    };
    expect(res.ok).toBe(false);
    expect(res.error).toContain('Cannot access contents');
    expect(mock.permissions.remove).toHaveBeenCalledWith({ origins: [`${ORIGIN}/*`] });
  });
});

describe('grant_created audit names capabilities', () => {
  beforeEach(async () => {
    await mock.storage.session.clear();
    await mock.storage.local.clear();
    mock.scripting.executeScript.mockResolvedValue([]);
  });

  it('names allow-navigate in the mint audit detail when the flag is set', async () => {
    mock.tabs.get.mockResolvedValue({ id: 3, url: `${ORIGIN}/page` });
    await sendPanelMessage({
      type: 'ctrGrantActiveTab',
      tabId: 3,
      mode: 'act',
      allowViewportScreenshot: false,
      allowNavigate: true,
    });
    const audit = await getAudit();
    const grantCreated = audit.find((e) => e.type === 'grant_created');
    expect(grantCreated?.detail).toContain('allow navigate');
  });

  it('does NOT name allow-navigate when the flag is off', async () => {
    mock.tabs.get.mockResolvedValue({ id: 3, url: `${ORIGIN}/page` });
    await sendPanelMessage({
      type: 'ctrGrantActiveTab',
      tabId: 3,
      mode: 'act',
      allowViewportScreenshot: false,
      allowNavigate: false,
    });
    const audit = await getAudit();
    const grantCreated = audit.find((e) => e.type === 'grant_created');
    expect(grantCreated?.detail).not.toContain('allow navigate');
  });
});

describe('§2.7: re-confirm to a different origin resets high-risk flags', () => {
  beforeEach(async () => {
    await mock.storage.session.clear();
    await mock.storage.local.clear();
    mock.scripting.executeScript.mockResolvedValue([]);
  });

  it('re-pin to a new origin: audit detail names the reset', async () => {
    const grant = await mintGrant(1, ORIGIN, Date.now(), 'act', true, true);
    await suspendGrant(grant.grantId);
    mock.tabs.get.mockResolvedValue({ id: 1, url: `${NEW_ORIGIN}/page` });

    const res = (await sendPanelMessage({
      type: 'ctrReconfirm',
      grantId: grant.grantId,
      expectedOrigin: NEW_ORIGIN,
    })) as { ok: boolean };
    expect(res.ok).toBe(true);

    const audit = await getAudit();
    const reconfirmed = audit.find((e) => e.type === 'grant_reconfirmed');
    expect(reconfirmed?.detail).toContain('reset autoApprove, allowViewportScreenshot');
    expect(reconfirmed?.detail).toContain(NEW_ORIGIN);
  });

  it('re-pin to the SAME origin: audit detail does NOT name a reset', async () => {
    const grant = await mintGrant(1, ORIGIN, Date.now(), 'act');
    await suspendGrant(grant.grantId);
    // Same-origin re-confirm (chrome-error recovery).
    mock.tabs.get.mockResolvedValue({ id: 1, url: `${ORIGIN}/recovered` });

    const res = (await sendPanelMessage({
      type: 'ctrReconfirm',
      grantId: grant.grantId,
      expectedOrigin: ORIGIN,
    })) as { ok: boolean };
    expect(res.ok).toBe(true);

    const audit = await getAudit();
    const reconfirmed = audit.find((e) => e.type === 'grant_reconfirmed');
    expect(reconfirmed?.detail).not.toContain('reset');
  });
});
