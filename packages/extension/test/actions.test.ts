// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executeAction, executePlan } from '../src/content/actions.js';
import { waitForQuiet } from '../src/content/settle.js';
import { captureSnapshot } from '../src/content/snapshot.js';

function el<T extends Element>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Missing ${selector}`);
  return found;
}

describe('executeAction', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('click', () => {
    it('clicks a button and reports the target description', () => {
      document.body.innerHTML = '<button>Save</button>';
      const clicked = vi.fn();
      el('button').addEventListener('click', clicked);
      const outcome = executeAction(el('button'), { kind: 'click', ref: 'n7' });
      expect(clicked).toHaveBeenCalledTimes(1);
      expect(outcome).toEqual({
        ok: true,
        result: { action: 'click', ref: 'n7', target: 'button "Save"' },
      });
    });

    it('clicks elements with an explicit ARIA role', () => {
      document.body.innerHTML = '<div role="tab">Tab A</div>';
      const clicked = vi.fn();
      el('div').addEventListener('click', clicked);
      expect(executeAction(el('div'), { kind: 'click', ref: 'n1' }).ok).toBe(true);
      expect(clicked).toHaveBeenCalled();
    });

    it('refuses to click plain non-interactive elements', () => {
      document.body.innerHTML = '<div>just text</div>';
      const outcome = executeAction(el('div'), { kind: 'click', ref: 'n1' });
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.code).toBe('invalid_target');
    });
  });

  describe('fill', () => {
    it('fills a text input and fires input + change events', () => {
      document.body.innerHTML = '<input type="text" aria-label="Search" value="old" />';
      const input = el<HTMLInputElement>('input');
      const events: string[] = [];
      input.addEventListener('input', () => events.push('input'));
      input.addEventListener('change', () => events.push('change'));
      const outcome = executeAction(input, { kind: 'fill', ref: 'n5', text: 'apples' });
      expect(input.value).toBe('apples');
      expect(events).toEqual(['input', 'change']);
      expect(outcome).toEqual({
        ok: true,
        result: { action: 'fill', ref: 'n5', target: 'textbox "Search"', text: 'apples' },
      });
    });

    it('fills a textarea', () => {
      document.body.innerHTML = '<textarea aria-label="Notes"></textarea>';
      const outcome = executeAction(el('textarea'), { kind: 'fill', ref: 'n2', text: 'hello' });
      expect(outcome.ok).toBe(true);
      expect(el<HTMLTextAreaElement>('textarea').value).toBe('hello');
    });

    it('ALWAYS refuses password fields', () => {
      document.body.innerHTML = '<input type="password" aria-label="PIN" />';
      const outcome = executeAction(el('input'), { kind: 'fill', ref: 'n3', text: 's3cret' });
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.code).toBe('invalid_target');
      expect(outcome.message).toContain('Password fields');
      expect(el<HTMLInputElement>('input').value).toBe('');
    });

    it('refuses non-text inputs and non-form elements', () => {
      document.body.innerHTML = '<input type="checkbox" /><div>x</div>';
      expect(executeAction(el('input'), { kind: 'fill', ref: 'n1', text: 'x' }).ok).toBe(false);
      expect(executeAction(el('div'), { kind: 'fill', ref: 'n2', text: 'x' }).ok).toBe(false);
    });
  });

  describe('select', () => {
    beforeEach(() => {
      document.body.innerHTML = `
        <select aria-label="Color">
          <option value="r">Red</option>
          <option value="g">Green</option>
        </select>`;
    });

    it('selects by option value and fires change', () => {
      const select = el<HTMLSelectElement>('select');
      const changed = vi.fn();
      select.addEventListener('change', changed);
      const outcome = executeAction(select, { kind: 'select', ref: 'n9', value: 'g' });
      expect(select.value).toBe('g');
      expect(changed).toHaveBeenCalled();
      expect(outcome).toEqual({
        ok: true,
        result: { action: 'select', ref: 'n9', target: 'combobox "Color"', value: 'g' },
      });
    });

    it('selects by visible label too', () => {
      const outcome = executeAction(el('select'), { kind: 'select', ref: 'n9', value: 'Green' });
      expect(outcome.ok).toBe(true);
      expect(el<HTMLSelectElement>('select').value).toBe('g');
    });

    it('lists available options when the value does not exist', () => {
      const outcome = executeAction(el('select'), { kind: 'select', ref: 'n9', value: 'Blue' });
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.code).toBe('invalid_target');
      expect(outcome.message).toContain('Red');
      expect(outcome.message).toContain('Green');
    });

    it('refuses select on non-select elements', () => {
      document.body.innerHTML = '<button>Save</button>';
      expect(executeAction(el('button'), { kind: 'select', ref: 'n1', value: 'x' }).ok).toBe(false);
    });
  });
});

describe('executePlan', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  function refOf(tag: string, name: string, capture: ReturnType<typeof captureSnapshot>): string {
    for (const [ref, element] of capture.refMap) {
      if (
        element.tagName.toLowerCase() === tag &&
        (element.textContent?.trim() === name || element.getAttribute('aria-label') === name)
      ) {
        return ref;
      }
    }
    throw new Error(`no ref for ${tag} ${name}`);
  }

  it('executes steps in order and reports all results', () => {
    document.body.innerHTML = '<input aria-label="Name" type="text" /><button>Save</button>';
    const capture = captureSnapshot(document);
    const fillRef = refOf('input', 'Name', capture);
    const clickRef = refOf('button', 'Save', capture);
    const clicked = vi.fn();
    el('button').addEventListener('click', clicked);

    const { executed, failedStep } = executePlan(capture.refMap, 0, [
      { kind: 'fill', ref: fillRef, text: 'Ada' },
      { kind: 'click', ref: clickRef },
    ]);
    expect(failedStep).toBeUndefined();
    expect(executed.map((r) => r.action)).toEqual(['fill', 'click']);
    expect(el<HTMLInputElement>('input').value).toBe('Ada');
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it('stops at the first failure; later steps never run', () => {
    document.body.innerHTML = '<button>A</button><button>B</button>';
    const capture = captureSnapshot(document);
    const clickedB = vi.fn();
    document.querySelectorAll('button')[1]!.addEventListener('click', clickedB);

    const { executed, failedStep } = executePlan(capture.refMap, 0, [
      { kind: 'fill', ref: refOf('button', 'A', capture), text: 'x' }, // fill a button → fails
      { kind: 'click', ref: refOf('button', 'B', capture) },
    ]);
    expect(executed).toHaveLength(0);
    expect(failedStep?.index).toBe(0);
    expect(failedStep?.code).toBe('invalid_target');
    expect(clickedB).not.toHaveBeenCalled();
  });

  it('fails with stale_ref when an earlier step detached the element', () => {
    document.body.innerHTML = '<button id="a">A</button><button id="b">B</button>';
    const capture = captureSnapshot(document);
    const refA = refOf('button', 'A', capture);
    const refB = refOf('button', 'B', capture);
    // Step 1's click removes button B from the DOM (SPA-style re-render).
    document.getElementById('a')!.addEventListener('click', () => document.getElementById('b')!.remove());

    const { executed, failedStep } = executePlan(capture.refMap, 0, [
      { kind: 'click', ref: refA },
      { kind: 'click', ref: refB },
    ]);
    expect(executed).toHaveLength(1);
    expect(failedStep).toMatchObject({ index: 1, code: 'stale_ref' });
  });
});

describe('waitForQuiet (DOM settle heuristic)', () => {
  it('resolves settled=true when the DOM goes quiet', async () => {
    document.body.innerHTML = '<div id="x"></div>';
    const promise = waitForQuiet(document, 30, 500);
    document.getElementById('x')!.textContent = 'changed';
    await expect(promise).resolves.toBe(true);
  });

  it('resolves settled=false (honest) when mutations never stop before the cap', async () => {
    document.body.innerHTML = '<div id="x"></div>';
    const interval = setInterval(() => {
      document.getElementById('x')!.textContent = String(Math.random());
    }, 10);
    const settled = await waitForQuiet(document, 50, 200);
    clearInterval(interval);
    expect(settled).toBe(false);
  });
});
