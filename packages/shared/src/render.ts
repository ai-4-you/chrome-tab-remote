// Compact prose rendering of tool results — the MCP output format. The
// consumer is a language model, so readable text IS the machine format
// (see AGENTS.md design principles).
import type { Grant } from './grant.js';
import type { ActionResult, FindResult, NavigateResult, PlanResult, TabReadManyResult } from './messages.js';
import type { SnapshotNode, SnapshotResult } from './snapshot.js';

function renderNode(node: SnapshotNode, depth: number, out: string[]): void {
  const parts = [node.ref, node.role];
  if (node.name) parts.push(JSON.stringify(node.name));
  if (node.value !== undefined) parts.push(`value=${JSON.stringify(node.value)}`);
  if (node.href) parts.push(node.href);
  if (node.options && node.options.length > 0) {
    parts.push(`options=[${node.options.map((o) => JSON.stringify(o)).join(', ')}]`);
  }
  out.push(`${'  '.repeat(depth)}- ${parts.join(' ')}`);
  for (const child of node.children ?? []) {
    renderNode(child, depth + 1, out);
  }
}

/**
 * Render a snapshot as indented text, one node per line:
 * `- <ref> <role> ["name"] [value="…"] [href]`, preceded by url/title header
 * lines. `truncated`/`filter` lines appear only when they carry information.
 */
export function renderSnapshot(result: SnapshotResult): string {
  const out = [`url: ${result.url}`, `title: ${result.title}`];
  if (result.filter === 'interactive') {
    out.push('filter: interactive (text content omitted — use filter "full" or tab_read for text)');
  }
  if (result.truncated) {
    out.push('truncated: true (node cap reached — the page has more content than shown)');
  }
  renderNode(result.tree, 0, out);
  return out.join('\n');
}

/**
 * Render the grant list as one prose line per grant, with expiry as derived
 * minutes (agents should not do timestamp arithmetic). The empty case is an
 * instruction, not a bare empty list. Expiry wins over stored status: the
 * store does not recompute status on read, and an expired grant cannot be
 * resumed by re-confirming — only re-granting helps.
 */
export function renderGrants(grants: Grant[], now: number): string {
  if (grants.length === 0) {
    return (
      'No grants. Ask the user to open the Chrome Tab Remote side panel on the tab ' +
      "they want to share and click 'Grant observe access'."
    );
  }
  return grants
    .map((g) => {
      const msLeft = Date.parse(g.expiresAt) - now;
      if (msLeft <= 0) {
        return (
          `${g.mode} grant for ${g.origin} — expired; the user must grant the tab ` +
          `again in the side panel (grantId ${g.grantId})`
        );
      }
      const screenshot = g.allowViewportScreenshot ? ', viewport screenshots ON' : '';
      const navigate = g.allowNavigate ? ', allow navigate ON' : '';
      const auto = g.autoApprove ? ', auto-approve ON (actions run without the approval pause)' : '';
      const line = `${g.mode} grant for ${g.origin} — ${g.status}${screenshot}${navigate}${auto}, expires in ~${Math.ceil(msLeft / 60_000)} min (grantId ${g.grantId})`;
      return g.status === 'suspended'
        ? `${line} — the user must click 'Re-confirm' in the side panel to resume access`
        : line;
    })
    .join('\n');
}

/**
 * One executed step as prose, e.g. 'Clicked button "Save" (n7)'. Scroll metrics are
 * rendered, not merely carried: the receipt is the ONLY observation of a scroll, so
 * an unrendered atBottom would be dead data (AGENTS.md prose principle).
 */
export function renderActionLine(result: ActionResult): string {
  const verb =
    result.action === 'click'
      ? `Clicked ${result.target}`
      : result.action === 'fill'
        ? `Filled ${result.target} with ${JSON.stringify(result.text ?? '')}`
        : result.action === 'select'
          ? `Selected ${JSON.stringify(result.value ?? '')} in ${result.target}`
          : `Scrolled ${result.target}${scrollMetricsClause(result)}`;
  return `${verb} (${result.ref})`;
}

function scrollMetricsClause(result: ActionResult): string {
  const m = result.scrollMetrics;
  if (!m) return '';
  const remaining = Math.max(0, m.scrollHeight - m.scrollTop - m.clientHeight);
  // atBottom is derived with a 2 px tolerance, so exact equality is the wrong test:
  // flag a bottom reached mid-scroll (a real position) as a possible lazy boundary,
  // while a page that never moved (scrollTop 0) stays a plain, unflagged bottom.
  const note =
    m.atBottom && m.scrollTop > 0 ? ', bottom reached — lazy content may still load' : '';
  return (
    ` to scrollTop ${m.scrollTop} of scrollHeight ${m.scrollHeight}` +
    ` (viewport ${m.clientHeight}px, ${remaining}px remaining, ` +
    `atBottom: ${m.atBottom ? 'yes' : 'no'}${note})`
  );
}

const PAGE_STATE_LINES: Record<PlanResult['pageState'], string> = {
  settled:
    'Page settled after the action(s). This is a dispatch receipt — it does not show the page. ' +
    'Call tab_snapshot (or tab_find) to observe the result.',
  'still-changing':
    'CAUTION: the page was STILL CHANGING when the action finished. Call tab_snapshot once it ' +
    'settles before relying on anything about the page.',
  interrupted:
    'Execution was INTERRUPTED by a page navigation or reload. How many steps completed before it ' +
    'is unknown — call tab_snapshot before doing anything else.',
};

/** Render a plan result: executed steps, first failure, and honest page state. */
export function renderPlanResult(result: PlanResult): string {
  const out: string[] = [];
  if (result.pageState !== 'interrupted') {
    result.executed.forEach((step, i) => out.push(`${i + 1}. ${renderActionLine(step)}`));
  }
  if (result.failedStep) {
    out.push(
      `Step ${result.failedStep.index + 1} FAILED (${result.failedStep.code}): ${result.failedStep.message} — remaining steps were not executed.`,
    );
  }
  out.push(PAGE_STATE_LINES[result.pageState]);
  return out.join('\n');
}

/** Render tab_read_many as one labelled, single-read-shaped block per requested ref. */
export function renderTabReadManyResult(result: TabReadManyResult): string {
  return result.results
    .map((item) => {
      const body = item.ok
        ? item.entry?.truncated
          ? item.entry.text === ''
            ? '[text not returned — aggregate 60,000-character cap already reached]'
            : `${item.entry.text}\n[truncated: aggregate 60,000-character cap]`
          : item.entry?.text === ''
            ? '[empty — the element has no text content or value]'
            : (item.entry?.text ?? '')
        : `${item.error?.code ?? 'unknown_ref'}: ${item.error?.message ?? 'Read failed.'}`;
      return `### ${item.ref}\n${body}`;
    })
    .join('\n\n');
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Render a navigate receipt as prose (spec §3.5). Two-tier: same-origin gets a
 * normal "Navigated … (loaded)" line; cross-origin states the suspension +
 * re-confirm + capability reset explicitly. Every result ends with the ref
 * invalidation + the screenshot re-invoke hint.
 */
export function renderNavigateResult(result: NavigateResult): string {
  const out: string[] = [];
  if (result.loadState === 'timeout') {
    out.push(
      `Navigated ${result.requestedUrl} — navigation dispatched; the page was still loading after the 30 s wait. ` +
        'An immediate tab_snapshot may fail (tab_unreachable) while the channel re-injects — wait ~5 s, then tab_snapshot.',
    );
  } else if (result.loadState === 'conflict') {
    if (result.grantStatus === 'suspended') {
      out.push(
        `The tab now shows ${result.finalUrl}, which this call did not load — and it is a different origin, so the grant is SUSPENDED. ` +
          'Ask the user to re-confirm for that origin in the side panel (or request_grant); auto-approve and screenshots are reset there (§2.7).',
      );
    } else {
      out.push(`The tab now shows ${result.finalUrl}, which this call did not load; take a snapshot to see where you are.`);
    }
  } else {
    if (result.finalUrl.startsWith('chrome-error:')) {
      out.push(
        `Navigated ${result.requestedUrl} — the load FAILED: the tab is on a Chrome error page (DNS failure or offline). ` +
          'The grant is suspended. Ask the user to re-confirm the grant in the side panel (or request_grant) once the page is reachable again.',
      );
    } else if (result.grantStatus === 'suspended') {
      const oldOrigin = originOf(result.requestedUrl) ?? result.requestedUrl;
      out.push(
        `Navigated to ${result.finalUrl} (loaded) — a DIFFERENT origin. ` +
          `The grant for ${oldOrigin} is SUSPENDED. Ask the user to re-confirm the grant for the new origin in the side panel ` +
          '(or request_grant); auto-approve and screenshots are reset there (§2.7).',
      );
    } else {
      out.push(
        result.finalUrl === result.requestedUrl
          ? `Navigated to ${result.requestedUrl} (loaded).`
          : `Navigated ${result.requestedUrl} → ${result.finalUrl} (loaded).`,
      );
    }
  }
  out.push('Snapshot refs are invalid — take a fresh tab_snapshot.');
  out.push(
    'tab_screenshot_viewport may require the user to re-invoke the toolbar action (activeTab persistence after same-origin navigation is unverified; cross-origin it is off until re-confirm anyway).',
  );
  return out.join('\n');
}

/** Render tab_find matches as one snapshot-style line each. */
export function renderFindResult(result: FindResult): string {
  if (result.total === 0) {
    return (
      `No matches on "${result.title}" (${result.url}). Try a shorter/different query, ` +
      'a different role, or take a tab_snapshot first and retry.'
    );
  }
  const out = [`${result.total} match(es) on "${result.title}" (${result.url}):`];
  for (const node of result.matches) {
    renderNode(node, 0, out);
  }
  if (result.total > result.matches.length) {
    out.push(`… ${result.total - result.matches.length} more — narrow the query.`);
  }
  out.push('Refs come from the latest tab_snapshot; tab_find does not invalidate them.');
  return out.join('\n');
}
