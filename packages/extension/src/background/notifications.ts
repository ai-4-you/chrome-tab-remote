// System notifications + toolbar badge — the approval gate must work even when
// the side panel is not visible (learned the hard way: four approval timeouts
// in the first live session). Everything is best-effort behind optional
// chaining: a missing API must never break the tool path.
const APPROVAL_ID = 'ctr-approval';
const REQUEST_ID = 'ctr-grant-request';

function show(id: string, title: string, message: string): void {
  try {
    chrome.notifications?.create(id, {
      type: 'basic',
      iconUrl: 'icon128.png',
      title,
      message: message.slice(0, 300),
    });
  } catch {
    /* notifications unavailable — badge still set */
  }
}

function clear(id: string): void {
  try {
    chrome.notifications?.clear(id);
  } catch {
    /* ignore */
  }
}

export function showApprovalNotification(summary: string, origin: string): void {
  show(APPROVAL_ID, 'Approval needed — Chrome Tab Remote', `Agent wants on ${origin}: ${summary}`);
}
export function clearApprovalNotification(): void {
  clear(APPROVAL_ID);
}

export function showGrantRequestNotification(reason: string | undefined, mode: 'observe' | 'act' = 'observe'): void {
  const capability = mode === 'act' ? 'a tab WITH actions' : 'a tab (read-only)';
  show(
    REQUEST_ID,
    'Tab access requested — Chrome Tab Remote',
    reason ? `The agent asks for ${capability}: ${reason}` : `The agent asks for ${capability}.`,
  );
}
export function clearGrantRequestNotification(): void {
  clear(REQUEST_ID);
}

/** Red "!" on the toolbar icon while anything awaits the user. */
export function setAttentionBadge(needsAttention: boolean): void {
  try {
    void chrome.action?.setBadgeText({ text: needsAttention ? '!' : '' });
    if (needsAttention) void chrome.action?.setBadgeBackgroundColor?.({ color: '#d93025' });
  } catch {
    /* ignore */
  }
}

/** Clicking a notification focuses the window (and opens the panel where allowed). */
export function wireNotificationClicks(getTabId: () => Promise<number | undefined>): void {
  try {
    chrome.notifications?.onClicked?.addListener(() => {
      void (async () => {
        const tabId = await getTabId();
        try {
          if (tabId !== undefined) {
            const tab = await chrome.tabs.update(tabId, { active: true });
            if (tab?.windowId !== undefined) {
              await chrome.windows.update(tab.windowId, { focused: true });
              await chrome.sidePanel.open({ windowId: tab.windowId });
            }
          }
        } catch {
          /* best effort */
        }
      })();
    });
  } catch {
    /* ignore */
  }
}
