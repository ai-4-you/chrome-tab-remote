// Page-mode scrolling and the scroll-container heuristic. Split out of actions.ts
// (mirroring settle.ts) so the layout walk is unit-testable in isolation: jsdom has
// no layout engine, so the tests must mock getComputedStyle and the scroll boxes.
import type { ScrollMetrics } from '@ctr/shared';
import { waitForQuiet } from './settle.js';

/**
 * How many candidate elements the container walk inspects before giving up. Bounds
 * cost on huge feeds — a lazy-loaded list can hold thousands of nodes.
 */
export const SCROLL_SCAN_CAP = 200;

const SCROLLABLE_OVERFLOW = new Set(['auto', 'scroll']);

/** True when `el` visibly overflows vertically and can be scrolled by the user. */
export function isVerticallyScrollable(el: Element, win: Window): boolean {
  const style = win.getComputedStyle(el);
  if (!SCROLLABLE_OVERFLOW.has(style.overflowY)) return false;
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  return el.scrollHeight > el.clientHeight && el.clientHeight > 0;
}

/**
 * Find the element the user would experience as "the scroller": descendants of
 * <body> in document order, capped at SCROLL_SCAN_CAP evaluations, whose COMPUTED
 * overflow-y is auto|scroll and that actually overflow vertically. Computed style
 * is the only thing that reflects author CSS, inheritance and overflow:hidden
 * parents — the attribute would miss almost every real app.
 *
 * Selection is the LARGEST clientHeight (the main feed, not an inner sidebar),
 * ties broken by earliest in document order. Returns null when nothing scrolls.
 */
export function findScrollContainer(doc: Document): Element | null {
  const root = doc.body;
  if (!root) return null;
  const win = doc.defaultView;
  if (!win) return null;

  let best: Element | null = null;
  let bestHeight = 0;
  let evaluated = 0;
  for (const el of root.querySelectorAll('*')) {
    if (evaluated >= SCROLL_SCAN_CAP) break;
    evaluated += 1;
    if (!isVerticallyScrollable(el, win)) continue;
    if (el.clientHeight > bestHeight) {
      best = el;
      bestHeight = el.clientHeight;
    }
  }
  return best;
}

/**
 * Metrics of the scroller that actually moved. atBottom is derived (not read from
 * the page) so it means the same thing on every site: within 2px of the end.
 */
export function measureScroller(el: Element): ScrollMetrics {
  const scrollTop = Math.round(el.scrollTop);
  const scrollHeight = Math.round(el.scrollHeight);
  const clientHeight = Math.round(el.clientHeight);
  return {
    scrollTop,
    scrollHeight,
    clientHeight,
    atBottom: scrollHeight - scrollTop - clientHeight <= 2,
  };
}

export interface PageScrollParams {
  direction: 'down' | 'up';
  pixels: number;
  behavior: 'instant' | 'auto';
}

export type PageScrollOutcome =
  | {
      ok: true;
      target: string;
      scrollMetrics: ScrollMetrics;
      /** Honest settle state of this scroll: lazy loaders keep mutating. */
      settled: boolean;
    }
  | { ok: false; code: 'invalid_target'; message: string };

const NO_SCROLLABLE_MESSAGE =
  'No scrollable region found on the page (no overflow container). ' +
  'Try an element ref from tab_snapshot.';

/** The document scroller, when IT is the thing that overflows. */
function documentScroller(doc: Document): Element | null {
  const se = doc.scrollingElement;
  if (!se) return null;
  return se.scrollHeight > se.clientHeight && se.clientHeight > 0 ? se : null;
}

/**
 * Page-mode scroller choice. An inner container that overflows AT LEAST as much as
 * the document wins, because on real app shells the document barely moves while the
 * feed is the thing the user means: preferring the document there would return a
 * success receipt for a scroll that did nothing useful (review finding, 2026-09-29).
 * The document still wins on a normal document-scrolled page, where no inner
 * container overflows more.
 */
function pickScroller(doc: Document): Element | null {
  const inner = findScrollContainer(doc);
  const outer = documentScroller(doc);
  if (inner && outer) {
    return inner.scrollHeight - inner.clientHeight >= outer.scrollHeight - outer.clientHeight
      ? inner
      : outer;
  }
  return inner ?? outer;
}

function describeScroller(el: Element, doc: Document): string {
  if (el === doc.scrollingElement || el === doc.documentElement || el === doc.body) {
    return 'the page';
  }
  const tag = el.tagName.toLowerCase();
  const label = (el.getAttribute('aria-label') ?? '').trim();
  if (label) return `${tag} "${label}"`;
  const cls = Array.from(el.classList)
    .filter((c) => !/^(?:is|has)-/.test(c))
    .slice(0, 2)
    .join('.');
  return cls ? `${tag}.${cls}` : tag;
}

/**
 * Page-mode scroll: the inner feed container when it overflows at least as much as
 * the document, otherwise the document scroller. A page with nothing to scroll FAILS
 * with invalid_target rather than returning a success receipt - a silent no-op
 * invites retry loops (settled in the spec discussion).
 *
 * Metrics are measured LATE: dispatch now, measure after the DOM has settled (and
 * once more when that settle came back still-changing, because lazy content may
 * still have been appended while we watched). Measuring immediately after scrollBy
 * would report atBottom from a pre-lazy-load layout and could tell the agent the
 * feed had ended while more posts were still arriving.
 *
 * Known limitation (pinned for live verification, 2026-09-29): the selection has no
 * modality awareness. When a modal or drawer with its own scroller is open, that
 * scroller usually has the largest clientHeight and will win — which is often what
 * the user means, but it is not guaranteed. The receipt names the scroller that
 * moved, so an agent can see whether it got the feed or the dialog.
 */
export async function scrollPage(
  doc: Document,
  params: PageScrollParams,
  settle: (doc: Document) => Promise<boolean> = waitForQuiet,
): Promise<PageScrollOutcome> {
  const scroller = pickScroller(doc);
  if (!scroller) return { ok: false, code: 'invalid_target', message: NO_SCROLLABLE_MESSAGE };

  const signed = params.direction === 'down' ? params.pixels : -params.pixels;
  if (typeof scroller.scrollBy === 'function') {
    scroller.scrollBy({ top: signed, left: 0, behavior: params.behavior });
  } else {
    scroller.scrollTop += signed; // jsdom / non-HTMLElement fallback
  }
  const target = describeScroller(scroller, doc);

  let settled = await settle(doc);
  let metrics = measureScroller(scroller);
  if (!settled) {
    // Still mutating: give the lazy loader one more quiet window before reading
    // the numbers the agent will act on.
    settled = await settle(doc);
    metrics = measureScroller(scroller);
  }
  return { ok: true, target, scrollMetrics: metrics, settled };
}
