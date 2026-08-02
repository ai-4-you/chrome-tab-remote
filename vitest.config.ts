import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Default environment is node; DOM-dependent tests (e.g. the extension
    // content script) opt into jsdom per file via `// @vitest-environment jsdom`.
    environment: 'node',
    include: ['packages/*/test/**/*.test.ts'],
  },
});
