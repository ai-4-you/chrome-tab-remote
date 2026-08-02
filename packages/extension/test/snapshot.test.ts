// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import type { SnapshotNode } from '@ctr/shared';
import {
  READ_TEXT_MAX_CHARS,
  SNAPSHOT_HREF_MAX_CHARS,
  SNAPSHOT_MAX_NODES,
  SNAPSHOT_NAME_MAX_CHARS,
} from '@ctr/shared';
import { captureSnapshot, readRef } from '../src/content/snapshot.js';

function flatten(node: SnapshotNode): SnapshotNode[] {
  return [node, ...(node.children ?? []).flatMap(flatten)];
}

function findByRole(node: SnapshotNode, role: string): SnapshotNode[] {
  return flatten(node).filter((n) => n.role === role);
}

describe('captureSnapshot', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.title = 'Test Page';
  });

  it('produces a document root with url, title and capturedAt', () => {
    document.body.innerHTML = '<p>Hello world</p>';
    const { result } = captureSnapshot(document);
    expect(result.tree.role).toBe('document');
    expect(result.tree.name).toBe('Test Page');
    expect(result.url).toContain('http');
    expect(result.title).toBe('Test Page');
    expect(result.truncated).toBe(false);
    expect(Date.parse(result.capturedAt)).not.toBeNaN();
  });

  it('maps tag semantics to roles and computes names', () => {
    document.body.innerHTML = `
      <nav aria-label="Primary">
        <a href="/docs">Documentation</a>
      </nav>
      <h1>Welcome</h1>
      <button>Save</button>
      <img src="x.png" alt="Company logo" />
      <img src="y.png" />
      <input id="email" type="text" value="a@b.c" />
      <label for="email">Email address</label>
    `;
    const { result } = captureSnapshot(document);
    const tree = result.tree;

    expect(findByRole(tree, 'navigation')[0]?.name).toBe('Primary');
    expect(findByRole(tree, 'link')[0]?.name).toBe('Documentation');
    expect(findByRole(tree, 'heading')[0]?.name).toBe('Welcome');
    expect(findByRole(tree, 'button')[0]?.name).toBe('Save');
    // Only images WITH alt are included.
    expect(findByRole(tree, 'img')).toHaveLength(1);
    expect(findByRole(tree, 'img')[0]?.name).toBe('Company logo');
    // label[for] naming + value.
    const textbox = findByRole(tree, 'textbox')[0];
    expect(textbox?.name).toBe('Email address');
    expect(textbox?.value).toBe('a@b.c');
  });

  it('prefers an explicit role attribute over tag semantics', () => {
    document.body.innerHTML = '<div role="search" aria-label="Site search"><p>x</p></div>';
    const { result } = captureSnapshot(document);
    const search = findByRole(result.tree, 'search')[0];
    expect(search?.name).toBe('Site search');
  });

  it('merges visible text into trimmed text runs', () => {
    document.body.innerHTML = '<div>  Hello \n  <!-- c -->  world  </div>';
    const { result } = captureSnapshot(document);
    const texts = findByRole(result.tree, 'text');
    expect(texts.map((t) => t.name)).toEqual(['Hello world']);
  });

  it('ALWAYS redacts password input values', () => {
    document.body.innerHTML = '<input type="password" value="s3cret" aria-label="PIN" />';
    const { result, refMap } = captureSnapshot(document);
    const pw = findByRole(result.tree, 'textbox')[0];
    expect(pw?.value).toBe('[redacted]');
    expect(JSON.stringify(result)).not.toContain('s3cret');
    // tab_read must NOT bypass the redaction either.
    const read = readRef(refMap, pw!.ref);
    expect(read).toEqual({ ok: true, text: '[redacted]' });
  });

  it('skips hidden elements (display:none, visibility:hidden, aria-hidden, hidden attr)', () => {
    document.body.innerHTML = `
      <button style="display:none">A</button>
      <button style="visibility:hidden">B</button>
      <button aria-hidden="true">C</button>
      <button hidden>D</button>
      <button>Visible</button>
      <div style="display:none"><h1>Hidden heading</h1></div>
    `;
    const { result } = captureSnapshot(document);
    const buttons = findByRole(result.tree, 'button');
    expect(buttons.map((b) => b.name)).toEqual(['Visible']);
    expect(findByRole(result.tree, 'heading')).toHaveLength(0);
  });

  it('caps the snapshot at SNAPSHOT_MAX_NODES and sets truncated', () => {
    const many = Array.from({ length: SNAPSHOT_MAX_NODES + 100 })
      .map((_, i) => `<button>b${i}</button>`)
      .join('');
    document.body.innerHTML = many;
    const { result } = captureSnapshot(document);
    expect(result.truncated).toBe(true);
    expect(flatten(result.tree)).toHaveLength(SNAPSHOT_MAX_NODES);
  });

  it('truncates names to SNAPSHOT_NAME_MAX_CHARS in the snapshot', () => {
    const long = 'x'.repeat(500);
    document.body.innerHTML = `<h1>${long}</h1>`;
    const { result } = captureSnapshot(document);
    expect(findByRole(result.tree, 'heading')[0]?.name).toHaveLength(SNAPSHOT_NAME_MAX_CHARS);
  });

  it('includes absolute http(s) hrefs on link nodes, omitting other schemes', () => {
    document.body.innerHTML = `
      <a href="/docs">Docs</a>
      <a href="https://other.example.com/x">External</a>
      <a href="javascript:void(0)">JS</a>
      <a href="mailto:a@b.c">Mail</a>
    `;
    const { result } = captureSnapshot(document);
    const links = findByRole(result.tree, 'link');
    expect(links.find((l) => l.name === 'Docs')?.href).toMatch(/^http.*\/docs$/);
    expect(links.find((l) => l.name === 'External')?.href).toBe('https://other.example.com/x');
    expect(links.find((l) => l.name === 'JS')?.href).toBeUndefined();
    expect(links.find((l) => l.name === 'Mail')?.href).toBeUndefined();
  });

  it('caps hrefs at SNAPSHOT_HREF_MAX_CHARS', () => {
    document.body.innerHTML = `<a href="https://example.com/${'x'.repeat(500)}">Long</a>`;
    const { result } = captureSnapshot(document);
    expect(findByRole(result.tree, 'link')[0]?.href).toHaveLength(SNAPSHOT_HREF_MAX_CHARS);
  });

  it("filter 'interactive' keeps controls and headings, drops text runs and structure", () => {
    document.body.innerHTML = `
      <nav><ul><li><a href="/home">Home</a></li></ul></nav>
      <h2>Section</h2>
      <p>Some long text content</p>
      <div role="tab">Tab A</div>
      <button>Save</button>
      <input type="text" aria-label="Name" />
    `;
    const { result, refMap } = captureSnapshot(document, 'interactive');
    expect(result.filter).toBe('interactive');
    const roles = flatten(result.tree).map((n) => n.role);
    expect(roles).toEqual(['document', 'link', 'heading', 'tab', 'button', 'textbox']);
    // Structure was spliced: the link is a direct child of the document root.
    expect(result.tree.children?.[0]?.role).toBe('link');
    // Every emitted ref stays readable via tab_read.
    for (const node of flatten(result.tree)) {
      expect(readRef(refMap, node.ref).ok, node.ref).toBe(true);
    }
  });

  it("filter defaults to 'full' and records it in the result", () => {
    document.body.innerHTML = '<p>text</p>';
    const { result } = captureSnapshot(document);
    expect(result.filter).toBe('full');
    expect(findByRole(result.tree, 'text')).toHaveLength(1);
  });

  it('assigns sequential refs unique within the snapshot', () => {
    document.body.innerHTML = '<h1>A</h1><button>B</button>';
    const { result } = captureSnapshot(document);
    const refs = flatten(result.tree).map((n) => n.ref);
    expect(new Set(refs).size).toBe(refs.length);
    for (const ref of refs) expect(ref).toMatch(/^n\d+$/);
  });
});

describe('readRef (tab_read)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.title = 'Test Page';
  });

  it('returns the FULL untruncated text for a ref from the last snapshot', () => {
    const long = 'word '.repeat(100).trim(); // 499 chars, way past the 120-char name cap
    document.body.innerHTML = `<h1>${long}</h1>`;
    const { result, refMap } = captureSnapshot(document);
    const heading = findByRole(result.tree, 'heading')[0]!;
    expect(heading.name.length).toBe(SNAPSHOT_NAME_MAX_CHARS);
    const read = readRef(refMap, heading.ref);
    expect(read).toEqual({ ok: true, text: long });
  });

  it('reads current input values', () => {
    document.body.innerHTML = '<input type="text" value="typed text" aria-label="Field" />';
    const { result, refMap } = captureSnapshot(document);
    const textbox = findByRole(result.tree, 'textbox')[0]!;
    expect(readRef(refMap, textbox.ref)).toEqual({ ok: true, text: 'typed text' });
  });

  it('caps tab_read text at READ_TEXT_MAX_CHARS (protects the 1 MB native-messaging frame)', () => {
    const long = 'a'.repeat(READ_TEXT_MAX_CHARS + 50);
    document.body.innerHTML = `<h1>${long}</h1>`;
    const { result, refMap } = captureSnapshot(document);
    const heading = findByRole(result.tree, 'heading')[0]!;
    const read = readRef(refMap, heading.ref);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.text.length).toBeLessThan(READ_TEXT_MAX_CHARS + 100);
    expect(read.text.startsWith('aaaa')).toBe(true);
    expect(read.text).toContain('[truncated: 50 more chars]');
  });

  it('rejects unknown refs with unknown_ref', () => {
    document.body.innerHTML = '<p>hi</p>';
    const { refMap } = captureSnapshot(document);
    const res = readRef(refMap, 'n9999');
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe('unknown_ref');
  });
});
