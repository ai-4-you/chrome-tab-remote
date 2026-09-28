// One-shot load-wait for chrome.tabs.update navigation.
//
// The navigate tool dispatches a navigation and then waits for the tab to
// finish loading so the receipt can report an honest loadState and final URL.
// The cleanup invariant is the whole point: EXACTLY ONE of {complete, timeout}
// wins, and the listener AND the timer are removed on every exit path — a
// leaked onUpdated listener would fire on the NEXT navigation (possibly one
// the user made themselves) and could be mistaken for this call's result.

/** 30 s load wait; the host budgets 150 s total for tab_navigate (110 + 30 + margin). */
export const NAVIGATE_LOAD_WAIT_MS = 30_000;

export type LoadState = 'complete' | 'timeout';

export interface LoadWaitOutcome {
  loadState: LoadState;
  /** Final URL observed (complete: from the load event; timeout: last known URL). */
  finalUrl: string | undefined;
  /**
   * Every `changeInfo.url` observed during this wait — the redirect chain.
   * Used for conflict attribution: a final URL never observed here was not
   * loaded by this call.
   */
  observedUrls: string[];
}

/**
 * Wait up to `timeoutMs` for the tab to finish loading after a navigation.
 * `initialUrl` is the tab's URL at dispatch time (the timeout fallback, since a
 * page that never loads reports no URL change).
 */
export function waitTabLoad(
  tabId: number,
  initialUrl: string | undefined,
  timeoutMs: number = NAVIGATE_LOAD_WAIT_MS,
): Promise<LoadWaitOutcome> {
  return new Promise((resolve) => {
    const observedUrls: string[] = [];
    let settled = false;
    let listener: ((tabId: number, changeInfo: { status?: string; url?: string }) => void) | null = null;
    // timer is assigned exactly once below; use let for the TDZ-safe declaration.
    // eslint-disable-next-line prefer-const
    let timer: ReturnType<typeof setTimeout>;

    const finish = (loadState: LoadState, finalUrl: string | undefined): void => {
      if (settled) return;
      settled = true;
      // Cleanup invariant: listener AND timer removed exactly once, on every exit.
      if (listener) chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timer);
      resolve({ loadState, finalUrl, observedUrls });
    };

    listener = (tabIdArg: number, changeInfo: { status?: string; url?: string }) => {
      if (tabIdArg !== tabId) return;
      if (typeof changeInfo.url === 'string' && changeInfo.url !== '') {
        observedUrls.push(changeInfo.url);
      }
      if (changeInfo.status === 'complete') {
        finish('complete', changeInfo.url);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);

    timer = setTimeout(() => finish('timeout', initialUrl), timeoutMs);
  });
}
