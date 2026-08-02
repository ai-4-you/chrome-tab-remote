import { describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  ERROR_RECOVERY,
  renderActionLine,
  renderFindResult,
  renderGrants,
  renderPlanResult,
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

  it('announces auto-approve so the agent knows the pause is off', () => {
    const text = renderGrants([{ ...grant, mode: 'act', autoApprove: true }], NOW);
    expect(text).toContain('auto-approve ON');
    expect(renderGrants([grant], NOW)).not.toContain('auto-approve');
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

describe('renderActionLine / renderPlanResult', () => {
  const CLICK = { action: 'click' as const, ref: 'n7', target: 'button "Save"' };

  it('renders each action verb with the target', () => {
    expect(renderActionLine(CLICK)).toBe('Clicked button "Save" (n7)');
    expect(renderActionLine({ action: 'fill', ref: 'n5', target: 'textbox "Search"', text: 'apples' })).toBe(
      'Filled textbox "Search" with "apples" (n5)',
    );
    expect(renderActionLine({ action: 'select', ref: 'n9', target: 'combobox "Color"', value: 'g' })).toBe(
      'Selected "g" in combobox "Color" (n9)',
    );
  });

  it('renders a settled plan with numbered steps and the embedded snapshot', () => {
    const text = renderPlanResult({ executed: [CLICK], pageState: 'settled', snapshot: base });
    expect(text).toContain('1. Clicked button "Save" (n7)');
    expect(text).toContain('Page settled after the action(s).');
    expect(text).toContain('fresh refs — ALL earlier refs are stale');
    expect(text).toContain('url: https://app.example.com/');
  });

  it('renders partial failure honestly: failed step + no further execution', () => {
    const text = renderPlanResult({
      executed: [CLICK],
      failedStep: { index: 1, code: 'stale_ref', message: 'Element gone.' },
      pageState: 'settled',
    });
    expect(text).toContain('Step 2 FAILED (stale_ref): Element gone. — remaining steps were not executed.');
  });

  it('warns loudly when the page was still changing (never fakes settledness)', () => {
    const text = renderPlanResult({ executed: [CLICK], pageState: 'still-changing' });
    expect(text).toContain('STILL CHANGING');
    expect(text).toContain('may be incomplete');
  });

  it('reports interruption with unknown completed-step count', () => {
    const text = renderPlanResult({ executed: [], pageState: 'interrupted', snapshot: base });
    expect(text).toContain('INTERRUPTED');
    expect(text).toContain('unknown');
    expect(text).not.toContain('1. Clicked');
  });
});

describe('renderFindResult', () => {
  it('renders matches as snapshot lines with the fresh-refs warning', () => {
    const text = renderFindResult({
      url: 'https://app.example.com/',
      title: 'Example',
      total: 2,
      matches: [
        { ref: 'n52', role: 'button', name: 'Login' },
        { ref: 'n60', role: 'link', name: 'Login help', href: 'https://app.example.com/help' },
      ],
    });
    expect(text).toContain('2 match(es)');
    expect(text).toContain('- n52 button "Login"');
    expect(text).toContain('- n60 link "Login help" https://app.example.com/help');
    expect(text).toContain('earlier refs are stale');
  });

  it('gives a helpful zero-matches message', () => {
    const text = renderFindResult({ url: 'https://x.example/', title: 'X', total: 0, matches: [] });
    expect(text).toContain('No matches');
    expect(text).toContain('fresh snapshot');
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
