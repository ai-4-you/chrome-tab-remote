// Action executors — the ONLY code that mutates the page. Deliberately small:
// click, fill, select on snapshot refs. No coordinates, no arbitrary JS.
// Pure DOM functions — unit-tested under jsdom.
import type { ActionResult } from '@ctr/shared';
import { describeElement } from './snapshot.js';

export type ActionRequest =
  | { kind: 'click'; ref: string }
  | { kind: 'fill'; ref: string; text: string }
  | { kind: 'select'; ref: string; value: string };

export type ActionOutcome =
  | { ok: true; result: ActionResult }
  | { ok: false; code: 'invalid_target'; message: string };

const CLICKABLE_TAGS = new Set(['a', 'button', 'input', 'select', 'textarea', 'option', 'summary', 'label']);
const UNFILLABLE_INPUT_TYPES = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'hidden', 'image']);

function invalid(message: string): ActionOutcome {
  return { ok: false, code: 'invalid_target', message };
}

/** Interactive by tag, by explicit ARIA role, or by an inline click handler. */
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

  if (action.kind === 'click') {
    if (!(el instanceof HTMLElement) || !isClickable(el)) {
      return invalid(`Element ${target} (${action.ref}) is not clickable.`);
    }
    el.click();
    return { ok: true, result: { action: 'click', ref: action.ref, target } };
  }

  if (action.kind === 'fill') {
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
