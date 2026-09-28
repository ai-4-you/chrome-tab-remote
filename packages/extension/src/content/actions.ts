// Action executors — the ONLY code that mutates the page. Deliberately small:
// click, fill, select, scroll on snapshot refs (plus the page scroller). No
// coordinates, no arbitrary JS. Pure DOM functions — unit-tested under jsdom.
import type { ActionResult, PlanStep } from '@ctr/shared';
import { SCROLL_DEFAULT_PIXELS } from '@ctr/shared';
import { classifyMissingRef, describeElement } from './snapshot.js';
import { measureScroller, scrollPage } from './scroll.js';
import { waitForQuiet } from './settle.js';

export type ActionRequest =
  | { kind: 'click'; ref: string }
  | { kind: 'fill'; ref: string; text: string }
  | { kind: 'select'; ref: string; value: string }
  /** Element-mode scroll: the ref is resolved and isConnected-checked by executePlan. */
  | { kind: 'scroll'; ref: string; direction?: 'down' | 'up'; pixels?: number; behavior?: 'instant' | 'auto' };

export type ActionOutcome =
  | { ok: true; result: ActionResult }
  | { ok: false; code: 'invalid_target'; message: string };

export interface PlanExecution {
  executed: ActionResult[];
  /** First failure; steps after it were NOT executed. */
  failedStep?: { index: number; code: string; message: string };
  /**
   * Settle state observed by a page-mode scroll (post-measurement). When present it
   * is more accurate than a settle wait started before the scroll dispatched, so
   * ctrPlan prefers it for pageState.
   */
  pageSettled?: boolean;
}

/**
 * Execute plan steps sequentially against the latest snapshot's refMap,
 * stopping at the first failure. Elements detached by earlier steps (SPA
 * re-render) fail with stale_ref instead of acting on ghosts.
 *
 * `doc` is the document page-mode scroll acts on; it is passed in rather than
 * read from a global so the executors stay unit-testable under jsdom.
 */
export async function executePlan(
  refMap: Map<string, Element>,
  refBase: number,
  steps: PlanStep[],
  doc: Document = document,
  settle: (doc: Document) => Promise<boolean> = waitForQuiet,
): Promise<PlanExecution> {
  const executed: ActionResult[] = [];
  /** Overridden by a page-mode scroll's own honest settle observation. */
  let pageSettled: boolean | undefined;
  for (const [index, step] of steps.entries()) {
    // Page-mode scroll has no element: it is not addressed by a snapshot ref, so
    // it must not be gated on refMap membership (that is what makes it work
    // without a prior tab_snapshot).
    if (step.kind === 'scroll' && step.ref === 'page') {
      // Awaited: scrollPage measures after the DOM settles, so atBottom describes
      // the post-lazy-load layout instead of the pre-scroll one.
      const outcome = await executePageScroll(
        doc,
        step as Extract<ActionRequest, { kind: 'scroll' }>,
        index === steps.length - 1 ? settle : async (d) => (await settle(d), true),
      );
      if (!outcome.ok) {
        return { executed, failedStep: { index, code: outcome.code, message: outcome.message } };
      }
      executed.push(outcome.result);
      pageSettled = outcome.result.pageSettled;
      continue;
    }
    const el = refMap.get(step.ref);
    if (!el) {
      return { executed, failedStep: { index, ...classifyMissingRef(step.ref, refBase) } };
    }
    if (!el.isConnected) {
      return {
        executed,
        failedStep: {
          index,
          code: 'stale_ref',
          message: `Element for ${step.ref} is no longer part of the page (changed by an earlier step?). Take a new tab_snapshot.`,
        },
      };
    }
    const outcome = executeAction(el, step as ActionRequest);
    if (!outcome.ok) {
      return { executed, failedStep: { index, code: outcome.code, message: outcome.message } };
    }
    executed.push(outcome.result);
  }
  return { executed, ...(pageSettled === undefined ? {} : { pageSettled }) };
}

const CLICKABLE_TAGS = new Set(['a', 'button', 'input', 'select', 'textarea', 'option', 'summary', 'label']);
const UNFILLABLE_INPUT_TYPES = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'hidden', 'image']);

function invalid(message: string): ActionOutcome {
  return { ok: false, code: 'invalid_target', message };
}

/** Nearest ancestor (inclusive) that can actually be scrolled vertically. */
function isScroller(node: Element, style: CSSStyleDeclaration): boolean {
  return (
    (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
    node.scrollHeight > node.clientHeight &&
    node.clientHeight > 0
  );
}

/** Nearest scrollable ancestor of `el`, falling back to the document scroller. */
function closestScrollerOf(el: Element): Element | null {
  const win = el.ownerDocument?.defaultView;
  if (!win) return null;
  for (let node: Element | null = el; node; node = node.parentElement) {
    if (isScroller(node, win.getComputedStyle(node))) return node;
  }
  const se = el.ownerDocument?.scrollingElement;
  return se && isScroller(se, win.getComputedStyle(se)) ? se : null;
}

/**
 * Page-mode scroll entry: no element is involved, so it cannot go through
 * executeAction's element-first signature. executePlan special-cases it here.
 */
export async function executePageScroll(
  doc: Document,
  step: Extract<ActionRequest, { kind: 'scroll' }>,
  settle?: (doc: Document) => Promise<boolean>,
): Promise<ActionOutcome> {
  const direction = step.direction;
  if (direction !== 'down' && direction !== 'up') {
    return invalid("Page-mode scroll requires direction: 'down' | 'up'.");
  }
  const outcome = await scrollPage(
    doc,
    {
      direction,
      pixels: step.pixels ?? SCROLL_DEFAULT_PIXELS,
      behavior: step.behavior ?? 'instant',
    },
    settle,
  );
  if (!outcome.ok) return invalid(outcome.message);
  return {
    ok: true,
    result: {
      action: 'scroll',
      ref: 'page',
      target: outcome.target,
      scrollMetrics: outcome.scrollMetrics,
      pageSettled: outcome.settled,
    },
  };
}
function isClickable(el: Element): boolean {
  return (
    CLICKABLE_TAGS.has(el.tagName.toLowerCase()) ||
    el.hasAttribute('role') ||
    el.hasAttribute('onclick')
  );
}


/**
 * Set a form value through the native prototype setter so framework-managed
 * inputs (React et al. patch the instance property) observe the change, then
 * fire the events real typing would.
 */
function setNativeValue(
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
): void {
  const proto = Object.getPrototypeOf(el) as object;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) {
    setter.call(el, value);
  } else {
    el.value = value;
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

export function executeAction(el: Element, action: ActionRequest): ActionOutcome {
  const target = describeElement(el);

  if (action.kind === 'scroll') {
    // Element mode: scrollIntoView is a side effect on a possibly-detached node,
    // so executePlan's isConnected guard runs BEFORE reaching this point.
    const behavior = action.behavior ?? 'instant';
    if (typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior, block: 'center', inline: 'nearest' });
    }
    // Metrics come from the closest scrollable ancestor — the scroller the user
    // actually sees move. Reporting the document instead would misstate atBottom.
    return {
      ok: true,
      result: {
        action: 'scroll',
        ref: action.ref,
        target,
        scrollMetrics: measureScroller(closestScrollerOf(el) ?? el),
      },
    };
  }

  if (action.kind === 'click') {
    if (!(el instanceof HTMLElement) || !isClickable(el)) {
      return invalid(`Element ${target} (${action.ref}) is not clickable.`);
    }
    el.click();
    return { ok: true, result: { action: 'click', ref: action.ref, target } };
  }

  if (action.kind === 'fill') {
    if (typeof action.text !== 'string') {
      return invalid('Missing text parameter for fill.');
    }
    if (el instanceof HTMLInputElement) {
      const type = (el.getAttribute('type') ?? 'text').toLowerCase();
      if (type === 'password') {
        // Mirror of the read-side redaction: the agent never touches credentials.
        return invalid('Password fields cannot be filled by the agent.');
      }
      if (UNFILLABLE_INPUT_TYPES.has(type)) {
        return invalid(`Element ${target} (${action.ref}) is not a text field (type=${type}).`);
      }
      setNativeValue(el, action.text);
      return { ok: true, result: { action: 'fill', ref: action.ref, target, text: action.text } };
    }
    if (el instanceof HTMLTextAreaElement) {
      setNativeValue(el, action.text);
      return { ok: true, result: { action: 'fill', ref: action.ref, target, text: action.text } };
    }
    return invalid(`Element ${target} (${action.ref}) is not a fillable text field.`);
  }

  // select
  if (typeof action.value !== 'string') {
    return invalid('Missing value parameter for select.');
  }
  if (!(el instanceof HTMLSelectElement)) {
    return invalid(`Element ${target} (${action.ref}) is not a <select>.`);
  }
  const options = Array.from(el.options);
  const wanted = action.value.trim();
  const match =
    options.find((o) => o.value === wanted) ??
    options.find((o) => (o.label || o.text).trim() === wanted);
  if (!match) {
    const available = options.slice(0, 10).map((o) => (o.label || o.text).trim());
    return invalid(
      `No option ${JSON.stringify(action.value)} in ${target} (${action.ref}). Available: ${available.join(', ')}`,
    );
  }
  setNativeValue(el, match.value);
  return { ok: true, result: { action: 'select', ref: action.ref, target, value: match.value } };
}
