import { describe, expect, it } from 'vitest';
import { resolveNativeHostNodePath } from '../scripts/native-node-path.mjs';

describe('resolveNativeHostNodePath', () => {
  it('uses Homebrew’s stable opt symlink when process.execPath is in a Cellar version directory', () => {
    const stable = '/opt/homebrew/opt/node@22/bin/node';

    expect(
      resolveNativeHostNodePath(
        '/opt/homebrew/Cellar/node@22/22.23.2_1/bin/node',
        (candidate: string) => candidate === stable,
      ),
    ).toBe(stable);
  });

  it('keeps the original path when no stable Homebrew symlink exists', () => {
    const executable = '/opt/homebrew/Cellar/node@22/22.23.2_1/bin/node';

    expect(resolveNativeHostNodePath(executable, () => false)).toBe(executable);
  });

  it('keeps non-Homebrew runtimes unchanged', () => {
    const executable = '/Users/example/.nvm/versions/node/v22.23.2/bin/node';

    expect(resolveNativeHostNodePath(executable, () => true)).toBe(executable);
  });
});
