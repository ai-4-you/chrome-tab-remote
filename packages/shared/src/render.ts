// Compact prose rendering of tool results — the MCP output format. The
// consumer is a language model, so readable text IS the machine format
// (see AGENTS.md design principles).
import type { Grant } from './grant.js';
import type { ActionResult } from './messages.js';
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

/**
 * Render an executed action as prose with the next-step hint: any action can
 * mutate the page, so refs from before it must be treated as stale.
 */
export function renderActionResult(result: ActionResult): string {
  const verb =
    result.action === 'click'
      ? `Clicked ${result.target}`
      : result.action === 'fill'
        ? `Filled ${result.target} with ${JSON.stringify(result.text ?? '')}`
        : `Selected ${JSON.stringify(result.value ?? '')} in ${result.target}`;
  return `${verb} (${result.ref}). The page may have changed — take a new tab_snapshot before further actions.`;
}
