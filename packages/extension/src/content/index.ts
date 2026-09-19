// Content script — injected programmatically (chrome.scripting.executeScript)
// into the ONE granted tab. Bundled as IIFE. Guards against double injection
// (re-confirm re-injects into the same tab).
import type { PlanStep, SnapshotResult } from '@ctr/shared';
import { findNodes } from '@ctr/shared';
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
  /** Latest captured snapshot; tab_find searches its tree, never the live DOM. */
  let lastSnapshotResult: SnapshotResult | null = null;
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
          lastSnapshotResult = capture.result;
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

      if (m.type === 'ctrReadMany') {
        const refs = (m as { refs?: unknown }).refs;
        if (!Array.isArray(refs) || refs.length < 1 || refs.length > 100 || !refs.every((ref) => typeof ref === 'string' && /^n\d+$/.test(ref))) {
          sendResponse({ ok: false, error: { code: 'invalid_target', message: 'refs must contain 1–100 node refs.' } });
          return false;
        }
        if (!lastRefMap) {
          sendResponse({ ok: false, error: { code: 'unknown_ref', message: 'No snapshot captured yet — call tab_snapshot first.' } });
          return false;
        }
        const aggregateCap = 60_000;
        let used = 0;
        const results = refs.map((ref) => {
          const r = readRef(lastRefMap!, ref, refBase);
          if (!r.ok) return { ref, ok: false, error: { code: r.code, message: r.message } };
          const remaining = aggregateCap - used;
          if (r.text.length > remaining) {
            used = aggregateCap;
            return { ref, ok: true, entry: { text: r.text.slice(0, Math.max(0, remaining)), truncated: true } };
          }
          used += r.text.length;
          return { ref, ok: true, entry: { text: r.text } };
        });
        sendResponse({ ok: true, result: { results } });
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
            // Wait for the DOM to go quiet (honestly capped). This is a dispatch
            // receipt, not an observation: callers take tab_snapshot to inspect it.
            const settled = await waitForQuiet(document);
            sendResponse({
              ok: true,
              result: {
                executed,
                failedStep,
                pageState: settled ? 'settled' : 'still-changing',
              },
            });
          } catch (e) {
            sendResponse({ ok: false, error: { code: 'tab_unreachable', message: `Plan failed: ${String(e)}` } });
          }
        })();
        return true; // async sendResponse
      }

      if (m.type === 'ctrFind') {
        if (!lastSnapshotResult) {
          sendResponse({ ok: false, error: { code: 'unknown_ref', message: 'No snapshot captured yet — call tab_snapshot first.' } });
          return false;
        }
        const query = typeof (m as { query?: unknown }).query === 'string'
          ? (m as { query: string }).query
          : '';
        const role = typeof (m as { role?: unknown }).role === 'string'
          ? (m as { role: string }).role
          : undefined;
        // Search the LATEST SNAPSHOT's tree, not the live DOM; findNodes is the
        // single matching path shared with the tested core.
        const { matches, total } = findNodes(lastSnapshotResult.tree, query, role);
        sendResponse({
          ok: true,
          result: { url: lastSnapshotResult.url, title: lastSnapshotResult.title, total, matches },
        });
        return false;
      }

      return false;
    },
  );
}
