// Accessibility-tree-like DOM snapshot.
// Included: landmarks, headings, links, buttons, inputs, images-with-alt and
// visible text runs (trimmed, merged). Hidden elements and password values are
// never exposed. Pure DOM functions — unit-tested under jsdom.
import type { SnapshotFilter, SnapshotNode, SnapshotResult } from '@ctr/shared';
import {
  READ_TEXT_MAX_CHARS,
  SNAPSHOT_HREF_MAX_CHARS,
  SNAPSHOT_MAX_NODES,
  SNAPSHOT_NAME_MAX_CHARS,
} from '@ctr/shared';

export interface SnapshotCapture {
  result: SnapshotResult;
  /** ref -> element map for the LAST snapshot; consumed by tab_read. */
  refMap: Map<string, Element>;
}

export type ReadResult =
  | { ok: true; text: string }
  | { ok: false; code: 'unknown_ref'; message: string };

const SKIP_TAGS = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'iframe',
  'object',
  'embed',
]);

/** Roles rendered as leaves — their text is already the accessible name. */
const LEAF_ROLES = new Set([
  'heading',
  'link',
  'button',
  'checkbox',
  'radio',
  'textbox',
  'combobox',
  'img',
]);

/**
 * Roles kept by filter 'interactive': everything an agent could target with a
 * future action, plus headings for orientation. Covers explicit ARIA widget
 * roles beyond what computeRole derives from tags.
 */
const INTERACTIVE_ROLES = new Set([
  'heading',
  'link',
  'button',
  'checkbox',
  'radio',
  'textbox',
  'combobox',
  'searchbox',
  'listbox',
  'option',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'slider',
  'spinbutton',
  'switch',
  'tab',
]);

interface WalkCtx {
  counter: number;
  truncated: boolean;
  refMap: Map<string, Element>;
  doc: Document;
  win: Window;
  filter: SnapshotFilter;
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Cap a name at SNAPSHOT_NAME_MAX_CHARS with a trailing … — the marker tells
 * an agent the name is incomplete and tab_read on the ref returns the rest.
 */
function truncateName(text: string): string {
  return text.length > SNAPSHOT_NAME_MAX_CHARS
    ? `${text.slice(0, SNAPSHOT_NAME_MAX_CHARS - 1)}…`
    : text;
}

function isHidden(el: Element, win: Window): boolean {
  if (el.getAttribute('aria-hidden') === 'true') return true;
  if ((el as HTMLElement).hidden) return true;
  const style = win.getComputedStyle(el);
  return style.display === 'none' || style.visibility === 'hidden';
}

/** Explicit role attribute wins; otherwise tag semantics. null = not interesting itself. */
function computeRole(el: Element): string | null {
  const explicit = el.getAttribute('role');
  if (explicit && explicit.trim()) return explicit.trim();
  const tag = el.tagName.toLowerCase();
  switch (tag) {
    case 'a':
      return el.hasAttribute('href') ? 'link' : null;
    case 'button':
      return 'button';
    case 'input': {
      const type = (el.getAttribute('type') ?? 'text').toLowerCase();
      if (type === 'hidden') return null;
      if (type === 'button' || type === 'submit' || type === 'reset') return 'button';
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      return 'textbox';
    }
    case 'textarea':
      return 'textbox';
    case 'select':
      return 'combobox';
    case 'img':
      // Only images with a non-empty alt text are included.
      return el.getAttribute('alt')?.trim() ? 'img' : null;
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return 'heading';
    case 'nav':
      return 'navigation';
    case 'main':
      return 'main';
    case 'header':
      return 'banner';
    case 'footer':
      return 'contentinfo';
    case 'aside':
      return 'complementary';
    case 'form':
      return 'form';
    case 'ul':
    case 'ol':
      return 'list';
    case 'li':
      return 'listitem';
    case 'table':
      return 'table';
    default:
      return null;
  }
}

/**
 * aria-label > aria-labelledby > alt > label[for] > (leaf roles only) text
 * content > placeholder > inner img alt > title. The last three are fallbacks
 * so common nameless-but-interactive elements (placeholder-only inputs, logo
 * links wrapping an image, icon links with a tooltip) still tell an agent what
 * they are.
 */
function computeName(el: Element, doc: Document, role: string): string {
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel && ariaLabel.trim()) return truncateName(collapse(ariaLabel));

  const labelledby = el.getAttribute('aria-labelledby');
  if (labelledby) {
    const parts = labelledby
      .split(/\s+/)
      .map((id) => collapse(doc.getElementById(id)?.textContent ?? ''))
      .filter((t) => t.length > 0);
    if (parts.length > 0) return truncateName(parts.join(' '));
  }

  const alt = el.getAttribute('alt');
  if (alt && alt.trim()) return truncateName(collapse(alt));

  if (el.id) {
    const label = doc.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    const labelText = collapse(label?.textContent ?? '');
    if (labelText) return truncateName(labelText);
  }

  if (LEAF_ROLES.has(role)) {
    const text = collapse(el.textContent ?? '');
    if (text) return truncateName(text);
  }

  const placeholder = el.getAttribute('placeholder');
  if (placeholder && placeholder.trim()) return truncateName(collapse(placeholder));

  const innerImgAlt = el.querySelector('img[alt]')?.getAttribute('alt');
  if (innerImgAlt && innerImgAlt.trim()) return truncateName(collapse(innerImgAlt));

  const title = el.getAttribute('title');
  if (title && title.trim()) return truncateName(collapse(title));

  return '';
}

/** Form control value; password values are ALWAYS redacted. */
function computeValue(el: Element): string | undefined {
  const tag = el.tagName.toLowerCase();
  if (tag === 'input') {
    const input = el as HTMLInputElement;
    if ((input.getAttribute('type') ?? '').toLowerCase() === 'password') {
      return '[redacted]';
    }
    return input.value || undefined;
  }
  if (tag === 'textarea') {
    return (el as HTMLTextAreaElement).value || undefined;
  }
  if (tag === 'select') {
    return (el as HTMLSelectElement).value || undefined;
  }
  return undefined;
}

/**
 * Absolute http(s) href for link nodes; other schemes (javascript:, mailto:, …)
 * are omitted. Over-long hrefs are cut with a trailing … so an agent never
 * mistakes a truncated URL for a complete one.
 */
function computeHref(el: Element): string | undefined {
  const href = (el as HTMLAnchorElement).href;
  if (typeof href !== 'string') return undefined;
  if (!href.startsWith('http://') && !href.startsWith('https://')) return undefined;
  return href.length > SNAPSHOT_HREF_MAX_CHARS
    ? `${href.slice(0, SNAPSHOT_HREF_MAX_CHARS - 1)}…`
    : href;
}

/** Allocate the next ref, or null when the node cap is reached (sets truncated). */
function nextRef(ctx: WalkCtx, el: Element): string | null {
  if (ctx.counter >= SNAPSHOT_MAX_NODES) {
    ctx.truncated = true;
    return null;
  }
  const ref = `n${ctx.counter}`;
  ctx.counter += 1;
  ctx.refMap.set(ref, el);
  return ref;
}

function walkElement(el: Element, ctx: WalkCtx): SnapshotNode[] {
  const tag = el.tagName.toLowerCase();
  if (SKIP_TAGS.has(tag)) return [];
  if (isHidden(el, ctx.win)) return [];

  const role = computeRole(el);
  if (role === null) {
    return walkChildren(el, ctx);
  }
  // Interactive filter: non-interactive structure (landmarks, lists, text
  // containers) gets no node of its own — its children are spliced up.
  if (ctx.filter === 'interactive' && !INTERACTIVE_ROLES.has(role)) {
    return walkChildren(el, ctx);
  }
  const ref = nextRef(ctx, el);
  if (ref === null) return [];
  const node: SnapshotNode = { ref, role, name: computeName(el, ctx.doc, role) };
  const value = computeValue(el);
  if (value !== undefined) node.value = value;
  if (role === 'link') {
    const href = computeHref(el);
    if (href !== undefined) node.href = href;
  }
  if (!LEAF_ROLES.has(role)) {
    const children = walkChildren(el, ctx);
    if (children.length > 0) node.children = children;
  }
  return [node];
}

/** Walk child nodes; merge consecutive visible text nodes into single text runs. */
function walkChildren(el: Element, ctx: WalkCtx): SnapshotNode[] {
  const out: SnapshotNode[] = [];
  let textBuf = '';
  const flushText = (): void => {
    const text = collapse(textBuf);
    textBuf = '';
    if (!text) return;
    if (ctx.filter === 'interactive') return;
    // Text refs map to the parent element (tab_read returns its full text).
    const ref = nextRef(ctx, el);
    if (ref === null) return;
    out.push({ ref, role: 'text', name: truncateName(text) });
  };
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === 3 /* TEXT_NODE */) {
      textBuf += ` ${child.textContent ?? ''}`;
      continue;
    }
    if (child.nodeType === 1 /* ELEMENT_NODE */) {
      flushText();
      out.push(...walkElement(child as Element, ctx));
    }
  }
  flushText();
  return out;
}

export function captureSnapshot(doc: Document, filter: SnapshotFilter = 'full'): SnapshotCapture {
  const win = doc.defaultView;
  if (!win || !doc.body) {
    throw new Error('Document has no window or body.');
  }
  const ctx: WalkCtx = {
    counter: 0,
    truncated: false,
    refMap: new Map(),
    doc,
    win,
    filter,
  };
  const rootRef = nextRef(ctx, doc.body);
  const children = walkChildren(doc.body, ctx);
  const tree: SnapshotNode = {
    ref: rootRef ?? 'n0',
    role: 'document',
    name: truncateName(collapse(doc.title)),
  };
  if (children.length > 0) tree.children = children;
  return {
    result: {
      url: win.location.href,
      title: doc.title,
      capturedAt: new Date().toISOString(),
      truncated: ctx.truncated,
      filter,
      tree,
    },
    refMap: ctx.refMap,
  };
}

/** Cap tab_read output so the toolResult frame stays far below the host's 1 MB native-messaging frame limit. */
function capText(text: string): string {
  return text.length > READ_TEXT_MAX_CHARS
    ? `${text.slice(0, READ_TEXT_MAX_CHARS)}\n[truncated: ${text.length - READ_TEXT_MAX_CHARS} more chars]`
    : text;
}

/**
 * tab_read: the text for a ref from the LAST snapshot — not name-truncated like
 * the snapshot (only capped at READ_TEXT_MAX_CHARS to protect the native
 * messaging frame limit). Password redaction is NOT bypassed.
 */
export function readRef(refMap: Map<string, Element>, ref: string): ReadResult {
  const el = refMap.get(ref);
  if (!el) {
    return { ok: false, code: 'unknown_ref', message: `Unknown ref: ${ref}` };
  }
  const tag = el.tagName.toLowerCase();
  if (tag === 'input') {
    const input = el as HTMLInputElement;
    if ((input.getAttribute('type') ?? '').toLowerCase() === 'password') {
      return { ok: true, text: '[redacted]' };
    }
    return { ok: true, text: capText(input.value) };
  }
  if (tag === 'textarea') {
    return { ok: true, text: capText((el as HTMLTextAreaElement).value) };
  }
  if (tag === 'select') {
    return { ok: true, text: capText((el as HTMLSelectElement).value) };
  }
  return { ok: true, text: capText(collapse(el.textContent ?? '')) };
}
