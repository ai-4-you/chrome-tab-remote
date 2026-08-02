// Content script — injected programmatically (chrome.scripting.executeScript)
// into the ONE granted tab. Bundled as IIFE. Guards against double injection
// (re-confirm re-injects into the same tab).
import { captureSnapshot, readRef } from './snapshot.js';

declare global {
  interface Window {
    __ctrContentInjected?: boolean;
  }
}

if (!window.__ctrContentInjected) {
  window.__ctrContentInjected = true;

  let lastRefMap: Map<string, Element> | null = null;

  chrome.runtime.onMessage.addListener(
    (msg: unknown, _sender, sendResponse: (response: unknown) => void) => {
      const m = (msg ?? {}) as { type?: string; ref?: unknown };

      if (m.type === 'ctrSnapshot') {
        try {
          const { result, refMap } = captureSnapshot(document);
          lastRefMap = refMap;
          sendResponse({ ok: true, result });
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
        const r = readRef(lastRefMap, m.ref);
        if (r.ok) {
          sendResponse({ ok: true, result: { ref: m.ref, text: r.text } });
        } else {
          sendResponse({ ok: false, error: { code: r.code, message: r.message } });
        }
        return false;
      }

      return false;
    },
  );
}
