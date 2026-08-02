// Content script — injected programmatically (chrome.scripting.executeScript)
// into the ONE granted tab. Bundled as IIFE. Guards against double injection
// (re-confirm re-injects into the same tab).
import type { PlanStep, SnapshotNode } from '@ctr/shared';
import { executePlan } from './actions.js';
import { waitForQuiet } from './settle.js';
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

      if (m.type === 'ctrPlan') {
        const steps = (m as { steps?: unknown }).steps;
        if (!Array.isArray(steps) || steps.length === 0) {
          sendResponse({ ok: false, error: { code: 'invalid_target', message: 'Malformed plan request.' } });
          return false;
        }
        if (!lastRefMap) {
          sendResponse({
            ok: false,
            error: { code: 'unknown_ref', message: 'No snapshot captured yet — call tab_snapshot first.' },
          });
          return false;
        }
        const map = lastRefMap;
        void (async () => {
          try {
            const { executed, failedStep } = executePlan(map, refBase, steps as PlanStep[]);
            if (executed.length === 0 && failedStep) {
              // Nothing happened: report a plain error (single-action ergonomics).
              sendResponse({ ok: false, error: { code: failedStep.code, message: failedStep.message } });
              return;
            }
            // Wait for the DOM to go quiet (honestly capped), then re-orient.
            const settled = await waitForQuiet(document);
            const capture = captureSnapshot(document, 'interactive', nextStart);
            lastRefMap = capture.refMap;
            refBase = nextStart;
            nextStart = capture.nextStart;
            sendResponse({
              ok: true,
              result: {
                executed,
                failedStep,
                pageState: settled ? 'settled' : 'still-changing',
                snapshot: capture.result,
              },
            });
          } catch (e) {
            sendResponse({ ok: false, error: { code: 'tab_unreachable', message: `Plan failed: ${String(e)}` } });
          }
        })();
        return true; // async sendResponse
      }

      if (m.type === 'ctrFind') {
        try {
          const query = typeof (m as { query?: unknown }).query === 'string'
            ? ((m as { query: string }).query).toLowerCase()
            : '';
          const role = typeof (m as { role?: unknown }).role === 'string'
            ? (m as { role: string }).role
            : undefined;
          const capture = captureSnapshot(document, 'full', nextStart);
          lastRefMap = capture.refMap;
          refBase = nextStart;
          nextStart = capture.nextStart;
          const flat: SnapshotNode[] = [];
          (function walk(node: SnapshotNode): void {
            flat.push(node);
            for (const child of node.children ?? []) walk(child);
          })(capture.result.tree);
          const matching = flat.filter(
            (node) =>
              (!role || node.role === role) &&
              (query === '' ||
                `${node.name} ${node.value ?? ''} ${node.href ?? ''}`.toLowerCase().includes(query)),
          );
          sendResponse({
            ok: true,
            result: {
              url: capture.result.url,
              title: capture.result.title,
              total: matching.length,
              matches: matching.slice(0, 30).map(({ children: _children, ...rest }) => rest),
            },
          });
        } catch (e) {
          sendResponse({ ok: false, error: { code: 'tab_unreachable', message: `Find failed: ${String(e)}` } });
        }
        return false;
      }

      return false;
    },
  );
}
