// DOM-settle heuristic. Detecting "the page is done" reliably is impossible
// from inside a page, so we do best effort AND report the confidence honestly:
// resolves true when the DOM was mutation-quiet for `quietMs`, false when
// `maxMs` elapsed while mutations were still arriving. Consumers surface this
// as pageState 'settled' | 'still-changing' — the agent is never made to
// believe it reliably sees final content (C-11).
import { SETTLE_MAX_MS, SETTLE_QUIET_MS } from '@ctr/shared';

export function waitForQuiet(
  doc: Document,
  quietMs: number = SETTLE_QUIET_MS,
  maxMs: number = SETTLE_MAX_MS,
): Promise<boolean> {
  return new Promise((resolve) => {
    const target = doc.documentElement;
    if (!target) {
      resolve(true);
      return;
    }
    let done = false;
    let quietTimer: ReturnType<typeof setTimeout>;
    const finish = (settled: boolean): void => {
      if (done) return;
      done = true;
      observer.disconnect();
      clearTimeout(quietTimer);
      clearTimeout(maxTimer);
      resolve(settled);
    };
    const observer = new MutationObserver(() => {
      clearTimeout(quietTimer);
      quietTimer = setTimeout(() => finish(true), quietMs);
    });
    observer.observe(target, { subtree: true, childList: true, attributes: true, characterData: true });
    quietTimer = setTimeout(() => finish(true), quietMs);
    const maxTimer = setTimeout(() => finish(false), maxMs);
  });
}
