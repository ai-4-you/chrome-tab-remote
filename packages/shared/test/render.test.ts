import { describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  ERROR_RECOVERY,
  renderGrants,
  renderSnapshot,
  type Grant,
  type SnapshotResult,
} from '@ctr/shared';

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

describe('renderGrants', () => {
  const NOW = Date.parse('2026-08-02T10:00:00.000Z');
  const grant: Grant = {
    grantId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    tabId: 7,
    origin: 'https://app.example.com',
    mode: 'observe',
    status: 'active',
    expiresAt: '2026-08-02T10:12:30.000Z',
    createdByGesture: true,
  };

  it('renders one prose line with derived minutes instead of a timestamp', () => {
    expect(renderGrants([grant], NOW)).toBe(
      'observe grant for https://app.example.com — active, expires in ~13 min ' +
        '(grantId 3fa85f64-5717-4562-b3fc-2c963f66afa6)',
    );
  });

  it('omits internal plumbing (tabId, createdByGesture, raw expiresAt)', () => {
    const text = renderGrants([grant], NOW);
    expect(text).not.toContain('tabId');
    expect(text).not.toContain('true');
    expect(text).not.toContain('2026-08-02T10:12');
  });

  it('renders a passed expiry as expired with a re-grant instruction, overriding stored status', () => {
    // The store does not recompute status on read: an expired grant still says
    // status 'active'. The rendering must not echo that contradiction.
    const text = renderGrants([grant], NOW + 60 * 60 * 1000);
    expect(text).toContain('— expired; the user must grant the tab again in the side panel');
    expect(text).not.toContain('active');
  });

  it('appends the re-confirm instruction for suspended grants', () => {
    const text = renderGrants([{ ...grant, status: 'suspended' }], NOW);
    expect(text).toContain('suspended');
    expect(text).toContain("click 'Re-confirm' in the side panel");
  });

  it('never suggests re-confirming a suspended grant that has expired (expiry wins)', () => {
    const text = renderGrants([{ ...grant, status: 'suspended' }], NOW + 60 * 60 * 1000);
    expect(text).toContain('expired; the user must grant the tab again');
    expect(text).not.toContain('Re-confirm');
  });

  it('turns the empty list into a grant instruction, not "[]"', () => {
    const text = renderGrants([], NOW);
    expect(text).toContain('No grants.');
    expect(text).toContain("click 'Grant observe access'");
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
