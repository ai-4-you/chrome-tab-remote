// Content script — injected programmatically (chrome.scripting.executeScript)
// into the ONE granted tab. Bundled as IIFE. Guards against double injection
// (re-confirm re-injects into the same tab).
import { executeAction, type ActionRequest } from './actions.js';
import { captureSnapshot, classifyMissingRef, describeElement, readRef } from './snapshot.js';

declare global {
  interface Window {
    __ctrContentInjected?: boolean;
  }
}

if (!window.__ctrContentInjected) {
  window.__ctrContentInjected = true;

  let lastRefMap: Map<string, Element> | null = null;
  // Monotonic ref counter across snapshots (see classifyMissingRef): refBase is
  // where the CURRENT snapshot started, nextStart is where the next one will.
  let refBase = 0;
  let nextStart = 0;

  /** Resolve a ref against the latest snapshot, or answer with stale_ref/unknown_ref. */
  function lookupRef(
    ref: unknown,
    sendResponse: (response: unknown) => void,
  ): Element | null {
    if (!lastRefMap || typeof ref !== 'string') {
      sendResponse({
        ok: false,
        error: { code: 'unknown_ref', message: 'No snapshot captured yet or missing ref.' },
      });
      return null;
    }
    const el = lastRefMap.get(ref);
    if (!el) {
      sendResponse({ ok: false, error: classifyMissingRef(ref, refBase) });
      return null;
    }
    return el;
  }

  chrome.runtime.onMessage.addListener(
    (msg: unknown, _sender, sendResponse: (response: unknown) => void) => {
      const m = (msg ?? {}) as { type?: string; ref?: unknown; filter?: unknown; action?: unknown };

      if (m.type === 'ctrSnapshot') {
        try {
          const filter = m.filter === 'interactive' ? 'interactive' : 'full';
          const capture = captureSnapshot(document, filter, nextStart);
          lastRefMap = capture.refMap;
          refBase = nextStart;
          nextStart = capture.nextStart;
          sendResponse({ ok: true, result: capture.result });
        } catch (e) {
          sendResponse({
            ok: false,
            error: { code: 'tab_unreachable', message: `Snapshot failed: ${String(e)}` },
          });
        }
        return false;
      }

      if (m.type === 'ctrRead') {
        if (!lastRefMap || typeof m.ref !== 'string') {
          sendResponse({
            ok: false,
            error: { code: 'unknown_ref', message: 'No snapshot captured yet or missing ref.' },
          });
          return false;
        }
        const r = readRef(lastRefMap, m.ref, refBase);
        if (r.ok) {
          sendResponse({ ok: true, result: { ref: m.ref, text: r.text } });
        } else {
          sendResponse({ ok: false, error: { code: r.code, message: r.message } });
        }
        return false;
      }

      // Pre-approval peek: lets the background show the user WHAT would be
      // acted on, and reject stale refs before bothering the user at all.
      if (m.type === 'ctrDescribe') {
        const el = lookupRef(m.ref, sendResponse);
        if (el) sendResponse({ ok: true, result: { target: describeElement(el) } });
        return false;
      }

      if (m.type === 'ctrAction') {
        const action = m.action as ActionRequest | undefined;
        if (!action || typeof action !== 'object' || typeof action.ref !== 'string') {
          sendResponse({
            ok: false,
            error: { code: 'invalid_target', message: 'Malformed action request.' },
          });
          return false;
        }
        const el = lookupRef(action.ref, sendResponse);
        if (!el) return false;
        try {
          const outcome = executeAction(el, action);
          if (outcome.ok) {
            sendResponse({ ok: true, result: outcome.result });
          } else {
            sendResponse({ ok: false, error: { code: outcome.code, message: outcome.message } });
          }
        } catch (e) {
          sendResponse({
            ok: false,
            error: { code: 'tab_unreachable', message: `Action failed: ${String(e)}` },
          });
        }
        return false;
      }

      return false;
    },
  );
}
