import { describe, expect, it } from 'vitest';
import { ERROR_CODES, ERROR_RECOVERY, renderSnapshot, type SnapshotResult } from '@ctr/shared';

const base: SnapshotResult = {
  url: 'https://app.example.com/',
  title: 'Example',
  capturedAt: '2026-08-02T12:00:00.000Z',
  truncated: false,
  tree: {
    ref: 'n0',
    role: 'document',
    name: 'Example',
    children: [
      {
        ref: 'n1',
        role: 'navigation',
        name: '',
        children: [{ ref: 'n2', role: 'link', name: 'Home', href: 'https://app.example.com/home' }],
      },
      { ref: 'n3', role: 'textbox', name: 'Search', value: 'apples' },
      { ref: 'n4', role: 'text', name: 'Hello world' },
    ],
  },
};

describe('renderSnapshot', () => {
  it('renders header lines and one indented line per node', () => {
    const text = renderSnapshot(base);
    expect(text.split('\n')).toEqual([
      'url: https://app.example.com/',
      'title: Example',
      '- n0 document "Example"',
      '  - n1 navigation',
      '    - n2 link "Home" https://app.example.com/home',
      '  - n3 textbox "Search" value="apples"',
      '  - n4 text "Hello world"',
    ]);
  });

  it('omits empty names but keeps empty values (an empty input is information)', () => {
    const text = renderSnapshot({
      ...base,
      tree: { ref: 'n0', role: 'document', name: '', children: [{ ref: 'n1', role: 'textbox', name: '', value: '' }] },
    });
    expect(text).toContain('- n0 document\n');
    expect(text).toContain('- n1 textbox value=""');
  });

  it('adds an explanatory truncated line only when truncated', () => {
    expect(renderSnapshot(base)).not.toContain('truncated');
    expect(renderSnapshot({ ...base, truncated: true })).toContain('truncated: true');
  });

  it('adds a filter line only for interactive snapshots', () => {
    expect(renderSnapshot({ ...base, filter: 'full' })).not.toContain('filter:');
    expect(renderSnapshot({ ...base, filter: 'interactive' })).toContain('filter: interactive');
  });

  it('escapes quotes and newlines in names via JSON encoding', () => {
    const text = renderSnapshot({
      ...base,
      tree: { ref: 'n0', role: 'heading', name: 'He said "hi"\nthere' },
    });
    expect(text).toContain('- n0 heading "He said \\"hi\\"\\nthere"');
  });
});

describe('ERROR_RECOVERY', () => {
  it('has a non-empty, actionable instruction for every error code', () => {
    for (const code of ERROR_CODES) {
      expect(ERROR_RECOVERY[code], code).toBeTruthy();
      expect(ERROR_RECOVERY[code].length, code).toBeGreaterThan(20);
    }
  });
});
