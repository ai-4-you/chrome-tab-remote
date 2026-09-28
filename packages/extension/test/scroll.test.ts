// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  SCROLL_SCAN_CAP,
  findScrollContainer,
  isVerticallyScrollable,
  measureScroller,
  scrollPage,
} from '../src/content/scroll.js';
import { ScrollMetricsSchema } from '@ctr/shared';

// jsdom has no layout engine: every scroll box and computed overflow value in
// these tests is INJECTED (see box()/overflow()). Live-browser behaviour of the
// heuristic is verified separately against a real infinite feed.
interface Box {
  scrollHeight?: number;
  clientHeight?: number;
  scrollTop?: number;
}

const tops = new WeakMap<Element, number>();

/**
 * Inject fake layout: jsdom has no layout engine (every scroll box reads 0) and
 * no Element.prototype.scrollBy, so this file drives the heuristic through
 * stubbed scroll boxes and a computed-style table keyed by element id.
 */
function box(node: Element, b: Box): Element {
  Object.defineProperty(node, 'scrollHeight', { value: b.scrollHeight ?? 0, configurable: true });
  Object.defineProperty(node, 'clientHeight', { value: b.clientHeight ?? 0, configurable: true });
  tops.set(node, b.scrollTop ?? 0);
  Object.defineProperty(node, 'scrollTop', {
    get: () => tops.get(node) ?? 0,
    set: (v: number) => tops.set(node, v),
    configurable: true,
  });
  return node;
}

/** Browser-parity branch: give a node a real scrollBy so scrollPage uses it. */
function stubScrollBy(node: Element): ReturnType<typeof vi.fn> {
  const spy = vi.fn((opts: ScrollToOptions) => tops.set(node, (tops.get(node) ?? 0) + (opts.top ?? 0)));
  node.scrollBy = spy as unknown as typeof node.scrollBy;
  return spy;
}

type OverflowSpec = { overflowY?: string; display?: string; visibility?: string };

/**
 * Computed style for the nodes named by id; anything not listed reads as a plain
 * visible block that does not overflow. The spy is replaced, never chained, so
 * repeated calls inside one test cannot recurse.
 */
function overflow(map: Record<string, OverflowSpec>): void {
  const win = document.defaultView!;
  vi.spyOn(win, 'getComputedStyle').mockImplementation(((node: Element) => {
    const m = map[(node as HTMLElement).id ?? ''] ?? {};
    return {
      overflowY: m.overflowY ?? 'visible',
      display: m.display ?? 'block',
      visibility: m.visibility ?? 'visible',
    } as unknown as CSSStyleDeclaration;
  }) as unknown as typeof win.getComputedStyle);
}

/** Pin the document scroller to "cannot scroll" so the inner container wins. */
function noDocumentScroll(): void {
  Object.defineProperty(document, 'scrollingElement', {
    value: document.documentElement,
    configurable: true,
  });
  Object.defineProperty(document.documentElement, 'scrollHeight', { value: 0, configurable: true });
  Object.defineProperty(document.documentElement, 'clientHeight', { value: 0, configurable: true });
}

function body(html: string): void {
  document.body.innerHTML = html;
}

describe('findScrollContainer (heuristic; layout is mocked — jsdom has none)', () => {
  it('returns null when nothing overflows', () => {
    body('<div id="a"></div>');
    box(document.getElementById('a')!, { scrollHeight: 100, clientHeight: 100 });
    overflow({ a: { overflowY: 'auto' } });
    expect(findScrollContainer(document)).toBeNull();
  });

  it('picks the overflowing descendant with the largest clientHeight, not the first', () => {
    // Document order puts the sidebar first: a naive first-match would pick it.
    body('<div id="sidebar"><span id="deep"></span></div><div id="feed"></div>');
    box(document.getElementById('sidebar')!, { scrollHeight: 5000, clientHeight: 300 });
    box(document.getElementById('feed')!, { scrollHeight: 9000, clientHeight: 800 });
    box(document.getElementById('deep')!, { scrollHeight: 10, clientHeight: 0 });
    overflow({ sidebar: { overflowY: 'auto' }, feed: { overflowY: 'scroll' } });
    expect(findScrollContainer(document)?.id).toBe('feed');
  });

  it('ignores an element whose COMPUTED overflow-y is visible even if the attribute says auto', () => {
    body('<div id="a" style="overflow-y:visible"></div>');
    box(document.getElementById('a')!, { scrollHeight: 5000, clientHeight: 800 });
    overflow({});
    expect(findScrollContainer(document)).toBeNull();
  });

  it('rejects hidden or zero-height candidates', () => {
    body('<div id="hidden"></div><div id="collapsed"></div>');
    box(document.getElementById('hidden')!, { scrollHeight: 5000, clientHeight: 800 });
    box(document.getElementById('collapsed')!, { scrollHeight: 5000, clientHeight: 0 });
    overflow({ hidden: { overflowY: 'auto', visibility: 'hidden' }, collapsed: { overflowY: 'auto' } });
    expect(findScrollContainer(document)).toBeNull();
  });

  it('finds a container nested deep below body (real apps nest the feed under app roots)', () => {
    body('<div id="app"><div><section><div id="nested"></div></section></div></div>');
    box(document.getElementById('nested')!, { scrollHeight: 4000, clientHeight: 700 });
    overflow({ nested: { overflowY: 'auto' } });
    expect(findScrollContainer(document)?.id).toBe('nested');
  });

  it('bounds the walk: an overflowing element past the cap is not evaluated', () => {
    const filler = Array.from({ length: SCROLL_SCAN_CAP }, (_, i) => `<div id="f${i}"></div>`).join('');
    body(`${filler}<div id="late"></div>`);
    for (let i = 0; i < SCROLL_SCAN_CAP; i += 1) {
      box(document.getElementById(`f${i}`)!, { scrollHeight: 10, clientHeight: 10 });
    }
    box(document.getElementById('late')!, { scrollHeight: 9000, clientHeight: 900 });
    const all: Record<string, { overflowY: string }> = { late: { overflowY: 'auto' } };
    for (let i = 0; i < SCROLL_SCAN_CAP; i += 1) all[`f${i}`] = { overflowY: 'visible' };
    overflow(all);
    expect(findScrollContainer(document)).toBeNull();
  });
});

describe('isVerticallyScrollable', () => {
  it('requires computed auto|scroll, real overflow and a visible box', () => {
    body('<div id="a"></div>');
    const a = box(document.getElementById('a')!, { scrollHeight: 500, clientHeight: 100 });
    overflow({ a: { overflowY: 'scroll' } });
    expect(isVerticallyScrollable(a, document.defaultView!)).toBe(true);
    overflow({ a: { overflowY: 'hidden' } });
    expect(isVerticallyScrollable(a, document.defaultView!)).toBe(false);
  });
});

describe('measureScroller', () => {
  it('derives atBottom from the scroller that moved, including a clamped page end', () => {
    // A page scrolled to its end reports atBottom even when scrollTop is
    // clamped below the ideal target (scrollHeight - top - viewport <= 2px).
    body('<div id="a"></div>');
    const a = document.getElementById('a')!;
    box(a, { scrollHeight: 1000, clientHeight: 200, scrollTop: 800 });
    expect(measureScroller(a)).toEqual({
      scrollTop: 800,
      scrollHeight: 1000,
      clientHeight: 200,
      atBottom: true,
    });
    document.body.innerHTML = '<div id="b"></div>';
    const b = document.getElementById('b')!;
    box(b, { scrollHeight: 1000, clientHeight: 200, scrollTop: 700 });
    expect(measureScroller(b).atBottom).toBe(false);
    document.body.innerHTML = '<div id="c"></div>';
    const c = document.getElementById('c')!;
    box(c, { scrollHeight: 1000, clientHeight: 200, scrollTop: 802 });
    expect(measureScroller(c).atBottom).toBe(true);
  });

  it('rounds fractional layout values so the schema stays satisfiable', async () => {
    // Chrome reports fractional scrollTop/scrollHeight; ScrollMetricsSchema
    // requires integers, so the reported metrics must be rounded, not raw.
    body('<div id="f"></div>');
    const feed = document.getElementById('f')!;
    Object.defineProperty(feed, 'scrollHeight', { value: 3000.6, configurable: true });
    Object.defineProperty(feed, 'clientHeight', { value: 800.4, configurable: true });
    tops.set(feed, 1999.5);
    Object.defineProperty(feed, 'scrollTop', {
      get: () => tops.get(feed) ?? 0,
      set: (v: number) => tops.set(feed, v),
      configurable: true,
    });
    overflow({ f: { overflowY: 'auto' } });
    const outcome = await scrollPage(document, { direction: 'down', pixels: 1, behavior: 'instant' });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(ScrollMetricsSchema.safeParse(outcome.scrollMetrics).success).toBe(true);
    // 1999.5 + 1px scrolled = 2000.5, reported rounded (the raw value is fractional
    // in Chrome and ScrollMetricsSchema demands integers).
    expect(outcome.scrollMetrics).toMatchObject({ scrollTop: 2001, scrollHeight: 3001, clientHeight: 800 });
  });
});

describe('scrollPage', () => {
  it('scrolls the inner container and reports ITS metrics (not the document)', async () => {
    body('<div id="feed" class="web-scroll"></div>');
    noDocumentScroll();
    const feed = document.getElementById('feed')!;
    box(feed, { scrollHeight: 4000, clientHeight: 900, scrollTop: 400 });
    const scrollBy = stubScrollBy(feed);
    overflow({ feed: { overflowY: 'auto' } });

    const outcome = await scrollPage(document, { direction: 'down', pixels: 800, behavior: 'instant' });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(scrollBy).toHaveBeenCalledWith({ top: 800, left: 0, behavior: 'instant' });
    expect(tops.get(feed)).toBe(1200);
    expect(outcome.target).toBe('div.web-scroll');
    expect(outcome.scrollMetrics).toEqual({
      scrollTop: 1200,
      scrollHeight: 4000,
      clientHeight: 900,
      atBottom: false,
    });
  });

  it('scrolls up with a negative offset', async () => {
    body('<div id="feed"></div>');
    noDocumentScroll();
    const feed = document.getElementById('feed')!;
    box(feed, { scrollHeight: 4000, clientHeight: 900, scrollTop: 900 });
    // No scrollBy stub on this node: the scrollTop fallback must move it up.
    overflow({ feed: { overflowY: 'auto' } });
    await scrollPage(document, { direction: 'up', pixels: 300, behavior: 'auto' });
    expect(tops.get(feed)).toBe(600);
  });

  it('fails with invalid_target and the recovery hint when nothing can scroll', async () => {
    body('<p>static page, no scroller</p>');
    noDocumentScroll();
    overflow({});
    const outcome = await scrollPage(document, { direction: 'down', pixels: 800, behavior: 'instant' });
    expect(outcome).toEqual({
      ok: false,
      code: 'invalid_target',
      message: expect.stringContaining('No scrollable region found'),
    });
    expect((outcome as { message: string }).message).toContain('tab_snapshot');
  });

  it('measures AFTER the settle wait so lazy-loaded growth is reflected in atBottom', async () => {
    // A lazy loader appends posts during the settle window. If metrics were read
    // straight after scrollBy, atBottom would be reported true while content was
    // still arriving — the agent would stop reading early and believe the feed ended.
    body('<div id="feed"></div>');
    noDocumentScroll();
    const feed = document.getElementById('feed')!;
    let scrollTop = 0;
    let scrollHeight = 1700; // exactly scrollTop(800 target)+clientHeight -> "bottom"
    Object.defineProperty(feed, 'clientHeight', { value: 900, configurable: true });
    Object.defineProperty(feed, 'scrollHeight', { get: () => scrollHeight, configurable: true });
    Object.defineProperty(feed, 'scrollTop', {
      get: () => scrollTop,
      set: (v: number) => (scrollTop = v),
      configurable: true,
    });
    overflow({ feed: { overflowY: 'auto' } });
    const settle = vi.fn(async (d: Document) => {
      expect(d).toBe(document);
      scrollHeight = 5000; // lazy posts arrive while we wait for quiet
      return true;
    });

    const outcome = await scrollPage(
      document,
      { direction: 'down', pixels: 800, behavior: 'instant' },
      settle,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(settle).toHaveBeenCalledTimes(1);
    expect(outcome.scrollMetrics.atBottom).toBe(false); // would be TRUE if measured early
    expect(outcome.scrollMetrics.scrollHeight).toBe(5000);
    expect(outcome.settled).toBe(true);
  });

  it('re-measures once when the first settle came back still-changing (lazy loader)', async () => {
    body('<div id="feed"></div>');
    noDocumentScroll();
    const feed = document.getElementById('feed')!;
    let scrollTop = 0;
    let scrollHeight = 4000;
    Object.defineProperty(feed, 'clientHeight', { value: 900, configurable: true });
    Object.defineProperty(feed, 'scrollHeight', { get: () => scrollHeight, configurable: true });
    Object.defineProperty(feed, 'scrollTop', {
      get: () => scrollTop,
      set: (v: number) => (scrollTop = v),
      configurable: true,
    });
    overflow({ feed: { overflowY: 'auto' } });
    let calls = 0;
    const settle = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        scrollHeight = 4200; // still appending during window 1
        return false; // honest: still-changing
      }
      scrollHeight = 4900; // finished appending during window 2
      return true;
    });
    const outcome = await scrollPage(
      document,
      { direction: 'down', pixels: 800, behavior: 'instant' },
      settle,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(settle).toHaveBeenCalledTimes(2);
    // The reported numbers are the LAST measurement, not the intermediate one.
    expect(outcome.scrollMetrics).toEqual({
      scrollTop: 800,
      scrollHeight: 4900,
      clientHeight: 900,
      atBottom: false,
    });
    expect(outcome.settled).toBe(true);
  });

  it('prefers the inner container over a structurally overflowing document (app shell)', async () => {
    // The regression this guards: html overflows a little (structural), the feed
    // overflows a lot. Preferring the document would "succeed" while doing nothing.
    body('<div id="feed"></div>');
    const se = document.documentElement;
    Object.defineProperty(document, 'scrollingElement', { value: se, configurable: true });
    box(se, { scrollHeight: 1000, clientHeight: 900 }); // barely overflows
    const feed = document.getElementById('feed')!;
    box(feed, { scrollHeight: 9000, clientHeight: 800 });
    overflow({ feed: { overflowY: 'auto' } });
    const outcome = await scrollPage(
      document,
      { direction: 'down', pixels: 800, behavior: 'instant' },
      async () => true,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // The inner feed moved, NOT the document — and the receipt names the feed, so
    // the agent can see which scroller actually moved.
    expect(outcome.target).toBe('div');
    expect(outcome.target).not.toBe('the page');
    expect(outcome.scrollMetrics.scrollHeight).toBe(9000);
  });

  it('prefers the document scroller and describes it as "the page" when it overflows', async () => {
    // jsdom exposes no document.scrollingElement, so it is stubbed to the
    // documentElement — that is what a real browser gives us.
    body('<div id="inner"></div>');
    const se = document.documentElement;
    Object.defineProperty(document, 'scrollingElement', { value: se, configurable: true });
    box(se, { scrollHeight: 3000, clientHeight: 800, scrollTop: 2200 });
    box(document.getElementById('inner')!, { scrollHeight: 10, clientHeight: 10 });
    overflow({ inner: { overflowY: 'auto' } }); // smaller than the document scroller
    const outcome = await scrollPage(document, { direction: 'down', pixels: 800, behavior: 'instant' });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.target).toBe('the page');
    expect(outcome.scrollMetrics).toEqual({
      scrollTop: 3000,
      scrollHeight: 3000,
      clientHeight: 800,
      atBottom: true,
    });
  });
});
