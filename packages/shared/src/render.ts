// Compact indented-text rendering of a snapshot — the MCP tool output format.
// Roughly halves the token cost versus the JSON tree while keeping every ref
// usable with tab_read.
import type { SnapshotNode, SnapshotResult } from './snapshot.js';

function renderNode(node: SnapshotNode, depth: number, out: string[]): void {
  const parts = [node.ref, node.role];
  if (node.name) parts.push(JSON.stringify(node.name));
  if (node.value !== undefined) parts.push(`value=${JSON.stringify(node.value)}`);
  if (node.href) parts.push(node.href);
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
