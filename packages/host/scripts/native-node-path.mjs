import path from 'node:path';

/**
 * Prefer Homebrew's stable formula symlink over a versioned Cellar executable.
 * Homebrew removes old Cellar directories during upgrades, whereas opt/<formula>
 * is updated to the active version.
 */
export function resolveNativeHostNodePath(executable, exists = () => true) {
  const match = executable.match(/^(.*)\/Cellar\/([^/]+)\/[^/]+\/bin\/node$/);
  if (!match) return executable;

  const stablePath = path.join(match[1], 'opt', match[2], 'bin', 'node');
  return exists(stablePath) ? stablePath : executable;
}
