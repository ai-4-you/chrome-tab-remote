// tab_find core: pure filtering over a snapshot tree. Lives in shared so the
// matching semantics are unit-testable outside the content-script IIFE.
import type { SnapshotNode } from './snapshot.js';

/** Max matches returned by tab_find; the total is still reported. */
export const FIND_MAX_MATCHES = 30;

/**
 * Depth-first search over a snapshot tree: case-insensitive substring match on
 * name, value, and href, optionally restricted to an exact role. Returns flat
 * nodes (children stripped) — [matches capped at FIND_MAX_MATCHES, total].
 */
export function findNodes(
  tree: SnapshotNode,
  query: string,
  role?: string,
): { matches: SnapshotNode[]; total: number } {
  const needle = query.toLowerCase();
  const matching: SnapshotNode[] = [];
  (function walk(node: SnapshotNode): void {
    const haystack = `${node.name} ${node.value ?? ''} ${node.href ?? ''}`.toLowerCase();
    if ((!role || node.role === role) && (needle === '' || haystack.includes(needle))) {
      matching.push(node);
    }
    for (const child of node.children ?? []) walk(child);
  })(tree);
  return {
    matches: matching.slice(0, FIND_MAX_MATCHES).map(({ children: _children, ...rest }) => rest),
    total: matching.length,
  };
}
