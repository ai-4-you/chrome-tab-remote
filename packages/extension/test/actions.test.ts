// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executeAction, executePlan } from '../src/content/actions.js';
import { waitForQuiet } from '../src/content/settle.js';
import { captureSnapshot } from '../src/content/snapshot.js';

function el<T extends Element>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Missing ${selector}`);
  return found;
}

describe('executeAction', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('click', () => {
    it('clicks a button and reports the target description', () => {
      document.body.innerHTML = '<button>Save</button>';
      const clicked = vi.fn();
      el('button').addEventListener('click', clicked);
      const outcome = executeAction(el('button'), { kind: 'click', ref: 'n7' });
      expect(clicked).toHaveBeenCalledTimes(1);
      expect(outcome).toEqual({
        ok: true,
        result: { action: 'click', ref: 'n7', target: 'button "Save"' },
      });
    });

    it('clicks elements with an explicit ARIA role', () => {
      document.body.innerHTML = '<div role="tab">Tab A</div>';
      const clicked = vi.fn();
      el('div').addEventListener('click', clicked);
      expect(executeAction(el('div'), { kind: 'click', ref: 'n1' }).ok).toBe(true);
      expect(clicked).toHaveBeenCalled();
    });

    it('refuses to click plain non-interactive elements', () => {
      document.body.innerHTML = '<div>just text</div>';
      const outcome = executeAction(el('div'), { kind: 'click', ref: 'n1' });
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.code).toBe('invalid_target');
    });
  });

  describe('fill', () => {
    it('fills a text input and fires input + change events', () => {
      document.body.innerHTML = '<input type="text" aria-label="Search" value="old" />';
      const input = el<HTMLInputElement>('input');
      const events: string[] = [];
      input.addEventListener('input', () => events.push('input'));
      input.addEventListener('change', () => events.push('change'));
      const outcome = executeAction(input, { kind: 'fill', ref: 'n5', text: 'apples' });
      expect(input.value).toBe('apples');
      expect(events).toEqual(['input', 'change']);
      expect(outcome).toEqual({
        ok: true,
        result: { action: 'fill', ref: 'n5', target: 'textbox "Search"', text: 'apples' },
      });
    });

    it('fills a textarea', () => {
      document.body.innerHTML = '<textarea aria-label="Notes"></textarea>';
      const outcome = executeAction(el('textarea'), { kind: 'fill', ref: 'n2', text: 'hello' });
      expect(outcome.ok).toBe(true);
      expect(el<HTMLTextAreaElement>('textarea').value).toBe('hello');
    });

    it('ALWAYS refuses password fields', () => {
      document.body.innerHTML = '<input type="password" aria-label="PIN" />';
      const outcome = executeAction(el('input'), { kind: 'fill', ref: 'n3', text: 's3cret' });
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.code).toBe('invalid_target');
      expect(outcome.message).toContain('Password fields');
      expect(el<HTMLInputElement>('input').value).toBe('');
    });

    it('refuses non-text inputs and non-form elements', () => {
      document.body.innerHTML = '<input type="checkbox" /><div>x</div>';
      expect(executeAction(el('input'), { kind: 'fill', ref: 'n1', text: 'x' }).ok).toBe(false);
      expect(executeAction(el('div'), { kind: 'fill', ref: 'n2', text: 'x' }).ok).toBe(false);
    });
  });

  describe('select', () => {
    beforeEach(() => {
      document.body.innerHTML = `
        <select aria-label="Color">
          <option value="r">Red</option>
          <option value="g">Green</option>
        </select>`;
    });

    it('selects by option value and fires change', () => {
      const select = el<HTMLSelectElement>('select');
      const changed = vi.fn();
      select.addEventListener('change', changed);
      const outcome = executeAction(select, { kind: 'select', ref: 'n9', value: 'g' });
      expect(select.value).toBe('g');
      expect(changed).toHaveBeenCalled();
      expect(outcome).toEqual({
        ok: true,
        result: { action: 'select', ref: 'n9', target: 'combobox "Color"', value: 'g' },
      });
    });

    it('selects by visible label too', () => {
      const outcome = executeAction(el('select'), { kind: 'select', ref: 'n9', value: 'Green' });
      expect(outcome.ok).toBe(true);
      expect(el<HTMLSelectElement>('select').value).toBe('g');
    });

    it('lists available options when the value does not exist', () => {
      const outcome = executeAction(el('select'), { kind: 'select', ref: 'n9', value: 'Blue' });
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.code).toBe('invalid_target');
      expect(outcome.message).toContain('Red');
      expect(outcome.message).toContain('Green');
    });

    it('refuses select on non-select elements', () => {
      document.body.innerHTML = '<button>Save</button>';
      expect(executeAction(el('button'), { kind: 'select', ref: 'n1', value: 'x' }).ok).toBe(false);
    });
  });
});

describe('executePlan', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  function refOf(tag: string, name: string, capture: ReturnType<typeof captureSnapshot>): string {
    for (const [ref, element] of capture.refMap) {
      if (
        element.tagName.toLowerCase() === tag &&
        (element.textContent?.trim() === name || element.getAttribute('aria-label') === name)
      ) {
        return ref;
      }
    }
    throw new Error(`no ref for ${tag} ${name}`);
  }

  it('executes steps in order and reports all results', async () => {
    document.body.innerHTML = '<input aria-label="Name" type="text" /><button>Save</button>';
    const capture = captureSnapshot(document);
    const fillRef = refOf('input', 'Name', capture);
    const clickRef = refOf('button', 'Save', capture);
    const clicked = vi.fn();
    el('button').addEventListener('click', clicked);

    const { executed, failedStep } = await executePlan(capture.refMap, 0, [
      { kind: 'fill', ref: fillRef, text: 'Ada' },
      { kind: 'click', ref: clickRef },
    ]);
    expect(failedStep).toBeUndefined();
    expect(executed.map((r) => r.action)).toEqual(['fill', 'click']);
    expect(el<HTMLInputElement>('input').value).toBe('Ada');
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it('stops at the first failure; later steps never run', async () => {
    document.body.innerHTML = '<button>A</button><button>B</button>';
    const capture = captureSnapshot(document);
    const clickedB = vi.fn();
    document.querySelectorAll('button')[1]!.addEventListener('click', clickedB);

    const { executed, failedStep } = await executePlan(capture.refMap, 0, [
      { kind: 'fill', ref: refOf('button', 'A', capture), text: 'x' }, // fill a button → fails
      { kind: 'click', ref: refOf('button', 'B', capture) },
    ]);
    expect(executed).toHaveLength(0);
    expect(failedStep?.index).toBe(0);
    expect(failedStep?.code).toBe('invalid_target');
    expect(clickedB).not.toHaveBeenCalled();
  });

  // --- scroll (jsdom has no layout: scroll boxes and overflow are stubbed) ----
  const tops = new WeakMap<Element, number>();

  function fakeLayout(node: Element, b: { scrollHeight: number; clientHeight: number; scrollTop?: number }): void {
    Object.defineProperty(node, 'scrollHeight', { value: b.scrollHeight, configurable: true });
    Object.defineProperty(node, 'clientHeight', { value: b.clientHeight, configurable: true });
    tops.set(node, b.scrollTop ?? 0);
    Object.defineProperty(node, 'scrollTop', {
      get: () => tops.get(node) ?? 0,
      set: (v: number) => tops.set(node, v),
      configurable: true,
    });
  }

  /** Computed style by element id: listed ids overflow, everything else does not. */
  function computedOverflow(scrollableIds: string[]): void {
    vi.spyOn(document.defaultView!, 'getComputedStyle').mockImplementation(((node: Element) => ({
      overflowY: scrollableIds.includes((node as HTMLElement).id) ? 'auto' : 'visible',
      display: 'block',
      visibility: 'visible',
    })) as unknown as Window['getComputedStyle']);
  }

  it('page-mode scroll reports the settle state it measured, not an optimistic one', async () => {
    // The reported numbers must come from AFTER the settle wait, and a page that is
    // still changing must be reported as still-changing rather than 'settled'.
    document.body.innerHTML = '<div id="feed" class="web-scroll"></div>';
    const feed = document.getElementById('feed')!;
    let scrollTop = 4100;
    let settleCalls = 0;
    Object.defineProperty(feed, 'clientHeight', { value: 900, configurable: true });
    Object.defineProperty(feed, 'scrollHeight', { get: () => (settleCalls === 0 ? 4900 : 6000), configurable: true });
    Object.defineProperty(feed, 'scrollTop', {
      get: () => scrollTop,
      set: (v: number) => (scrollTop = v),
      configurable: true,
    });
    Object.defineProperty(feed, 'scrollBy', {
      value: (opts: { top: number }) => {
        scrollTop += opts.top;
      },
      configurable: true,
    });
    const css = vi
      .spyOn(window, 'getComputedStyle')
      .mockImplementation(
        () => ({ overflowY: 'auto', display: 'block', visibility: 'visible' }) as unknown as CSSStyleDeclaration,
      );
    const settle = vi.fn(async () => {
      settleCalls += 1; // lazy posts land during the wait: the page is not quiet
      return false;
    });
    try {
      const { executed, failedStep, pageSettled } = await executePlan(
        new Map(),
        0,
        [{ kind: 'scroll', ref: 'page', direction: 'down', pixels: 800, behavior: 'instant' }],
        document,
        settle,
      );
      expect(failedStep).toBeUndefined();
      expect(pageSettled).toBe(false);
      expect(executed[0]?.target).toBe('div.web-scroll');
      // Two settle windows ran, and the numbers are the LAST measurement (scrollHeight
      // grew 4900 -> 6000 as content was appended).
      expect(settle).toHaveBeenCalledTimes(2);
      expect(executed[0]?.scrollMetrics).toEqual({
        scrollTop: 4900,
        scrollHeight: 6000,
        clientHeight: 900,
        atBottom: false,
      });
    } finally {
      css.mockRestore();
    }
  });

  it('element-mode scroll scrolls into view and reports the CLOSEST scroller metrics', async () => {
    document.body.innerHTML = '<div id="feed"><button id="b">Load</button></div>';
    const capture = captureSnapshot(document);
    const refB = refOf('button', 'Load', capture);
    const feed = document.getElementById('feed')!;
    const button = document.getElementById('b')!;
    fakeLayout(feed, { scrollHeight: 5000, clientHeight: 900, scrollTop: 1200 });
    fakeLayout(button, { scrollHeight: 40, clientHeight: 40 });
    const scrolled = vi.fn();
    button.scrollIntoView = scrolled;
    computedOverflow(['feed']);

    const { executed, failedStep } = await executePlan(capture.refMap, 0, [{ kind: 'scroll', ref: refB }]);
    expect(failedStep).toBeUndefined();
    expect(scrolled).toHaveBeenCalledTimes(1);
    expect(executed[0]).toEqual({
      action: 'scroll',
      ref: refB,
      target: 'button "Load"',
      // Metrics come from the feed the user sees move, not the button itself.
      scrollMetrics: { scrollTop: 1200, scrollHeight: 5000, clientHeight: 900, atBottom: false },
    });
  });

  /** Pin the document scroller to "cannot scroll" so the inner container decides. */
  function noDocumentScroll(): void {
    Object.defineProperty(document, 'scrollingElement', {
      value: document.documentElement,
      configurable: true,
    });
    Object.defineProperty(document.documentElement, 'scrollHeight', { value: 0, configurable: true });
    Object.defineProperty(document.documentElement, 'clientHeight', { value: 0, configurable: true });
  }

  it('page-mode scroll works with an empty refMap (no prior snapshot needed)', async () => {
    document.body.innerHTML = '<div id="feed" class="web-scroll"></div>';
    const feed = document.getElementById('feed')!;
    fakeLayout(feed, { scrollHeight: 3000, clientHeight: 800 });
    const scrollBy = vi.fn((opts: ScrollToOptions) => tops.set(feed, (tops.get(feed) ?? 0) + (opts.top ?? 0)));
    feed.scrollBy = scrollBy as unknown as typeof feed.scrollBy;
    computedOverflow(['feed']);

    const { executed, failedStep } = await executePlan(new Map(), 0, [
      { kind: 'scroll', ref: 'page', direction: 'down', pixels: 800 },
    ]);
    expect(failedStep).toBeUndefined();
    expect(scrollBy).toHaveBeenCalledWith({ top: 800, left: 0, behavior: 'instant' });
    // pageSettled is an internal observation (ctrPlan strips it before the host),
    // so it is asserted separately from the host-facing shape.
    const { pageSettled: internal, ...forwarded } = executed[0]!;
    expect(internal).toBe(true);
    expect(forwarded).toEqual({
      action: 'scroll',
      ref: 'page',
      target: 'div.web-scroll',
      scrollMetrics: { scrollTop: 800, scrollHeight: 3000, clientHeight: 800, atBottom: false },
    });
  });

  it('page-mode scroll fails with invalid_target when nothing can scroll', async () => {
    noDocumentScroll();
    document.body.innerHTML = '<p>static page</p>';
    computedOverflow([]);
    const { executed, failedStep } = await executePlan(new Map(), 0, [
      { kind: 'scroll', ref: 'page', direction: 'down' },
    ]);
    expect(executed).toHaveLength(0);
    expect(failedStep).toMatchObject({ index: 0, code: 'invalid_target' });
    expect(failedStep?.message).toContain('No scrollable region found');
    expect(failedStep?.message).toContain('tab_snapshot');
  });

  it('page-mode scroll without a direction fails instead of silently doing nothing', async () => {
    noDocumentScroll();
    document.body.innerHTML = '<p>static</p>';
    computedOverflow([]);
    const { failedStep } = await executePlan(new Map(), 0, [{ kind: 'scroll', ref: 'page' }]);
    expect(failedStep).toMatchObject({ code: 'invalid_target' });
    expect(failedStep?.message).toContain('direction');
  });

  it('a failing scroll step stops the rest of the plan', async () => {
    noDocumentScroll();
    document.body.innerHTML = '<button>A</button>';
    const capture = captureSnapshot(document);
    const clicked = vi.fn();
    el('button').addEventListener('click', clicked);
    computedOverflow([]);
    const { executed, failedStep } = await executePlan(capture.refMap, 0, [
      { kind: 'scroll', ref: 'page', direction: 'down' },
      { kind: 'click', ref: refOf('button', 'A', capture) },
    ]);
    expect(executed).toHaveLength(0);
    expect(failedStep).toMatchObject({ index: 0, code: 'invalid_target' });
    expect(clicked).not.toHaveBeenCalled();
  });
});

describe('waitForQuiet (DOM settle heuristic)', () => {
  it('resolves settled=true when the DOM goes quiet', async () => {
    document.body.innerHTML = '<div id="x"></div>';
    const promise = waitForQuiet(document, 30, 500);
    document.getElementById('x')!.textContent = 'changed';
    await expect(promise).resolves.toBe(true);
  });

  it('resolves settled=false (honest) when mutations never stop before the cap', async () => {
    document.body.innerHTML = '<div id="x"></div>';
    const interval = setInterval(() => {
      document.getElementById('x')!.textContent = String(Math.random());
    }, 10);
    const settled = await waitForQuiet(document, 50, 200);
    clearInterval(interval);
    expect(settled).toBe(false);
  });
});
