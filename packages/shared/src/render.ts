// Compact prose rendering of tool results — the MCP output format. The
// consumer is a language model, so readable text IS the machine format
// (see AGENTS.md design principles).
import type { Grant } from './grant.js';
import type { ActionResult, FindResult, PlanResult } from './messages.js';
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
      const auto = g.autoApprove ? ', auto-approve ON (actions run without the approval pause)' : '';
      const line = `${g.mode} grant for ${g.origin} — ${g.status}${auto}, expires in ~${Math.ceil(msLeft / 60_000)} min (grantId ${g.grantId})`;
      return g.status === 'suspended'
        ? `${line} — the user must click 'Re-confirm' in the side panel to resume access`
        : line;
    })
    .join('\n');
}

/** One executed step as prose, e.g. 'Clicked button "Save" (n7)'. */
export function renderActionLine(result: ActionResult): string {
  const verb =
    result.action === 'click'
      ? `Clicked ${result.target}`
      : result.action === 'fill'
        ? `Filled ${result.target} with ${JSON.stringify(result.text ?? '')}`
        : `Selected ${JSON.stringify(result.value ?? '')} in ${result.target}`;
  return `${verb} (${result.ref})`;
}

const PAGE_STATE_LINES: Record<PlanResult['pageState'], string> = {
  settled: 'Page settled after the action(s).',
  'still-changing':
    'CAUTION: the page was STILL CHANGING when captured — the snapshot below may be ' +
    'incomplete. If results look wrong, take a new tab_snapshot.',
  interrupted:
    'Execution was INTERRUPTED by a page navigation or reload (likely caused by an ' +
    'action). How many steps completed before it is unknown — verify against the ' +
    'snapshot below before doing anything else.',
};

/**
 * Render a plan result: executed steps, first failure, honest page state, and
 * the fresh snapshot (whose refs are the only valid ones now).
 */
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
  if (result.snapshot) {
    out.push('', 'Current page (fresh refs — ALL earlier refs are stale now):');
    out.push(renderSnapshot(result.snapshot));
  }
  return out.join('\n');
}

/** Render tab_find matches as one snapshot-style line each. */
export function renderFindResult(result: FindResult): string {
  if (result.total === 0) {
    return (
      `No matches on "${result.title}" (${result.url}). Try a shorter/different query, ` +
      'a different role, or a full tab_snapshot. Note: tab_find took a fresh snapshot — ' +
      'earlier refs are now stale.'
    );
  }
  const out = [`${result.total} match(es) on "${result.title}" (${result.url}):`];
  for (const node of result.matches) {
    renderNode(node, 0, out);
  }
  if (result.total > result.matches.length) {
    out.push(`… ${result.total - result.matches.length} more — narrow the query.`);
  }
  out.push('Refs come from a FRESH snapshot taken by tab_find — all earlier refs are stale.');
  return out.join('\n');
}
