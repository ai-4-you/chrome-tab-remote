import { describe, expect, it } from 'vitest';
import {
  SNAPSHOT_MAX_NODES,
  SNAPSHOT_NAME_MAX_CHARS,
  SnapshotNodeSchema,
  SnapshotResultSchema,
  type SnapshotNode,
} from '@ctr/shared';

const leaf: SnapshotNode = { ref: 'n2', role: 'link', name: 'Docs', value: '/docs' };

const tree: SnapshotNode = {
  ref: 'n1',
  role: 'document',
  name: 'Example',
  children: [leaf, { ref: 'n3', role: 'button', name: 'Save' }],
};

describe('SnapshotNodeSchema', () => {
  it('accepts a recursive tree', () => {
    expect(SnapshotNodeSchema.parse(tree)).toEqual(tree);
  });

  it('accepts deeply nested children', () => {
    const deep: SnapshotNode = {
      ref: 'n1',
      role: 'document',
      name: '',
      children: [{ ref: 'n2', role: 'main', name: '', children: [leaf] }],
    };
    expect(SnapshotNodeSchema.safeParse(deep).success).toBe(true);
  });

  it('rejects a ref not matching n<counter>', () => {
    expect(SnapshotNodeSchema.safeParse({ ...leaf, ref: 'x2' }).success).toBe(false);
    expect(SnapshotNodeSchema.safeParse({ ...leaf, ref: 'n' }).success).toBe(false);
  });

  it('rejects an empty role', () => {
    expect(SnapshotNodeSchema.safeParse({ ...leaf, role: '' }).success).toBe(false);
  });

  it('rejects invalid children entries', () => {
    const bad = { ...tree, children: [{ role: 'link' }] };
    expect(SnapshotNodeSchema.safeParse(bad).success).toBe(false);
  });
});

describe('SnapshotResultSchema', () => {
  const result = {
    url: 'https://app.example.com/page',
    title: 'Example',
    capturedAt: '2026-08-02T12:00:00.000Z',
    truncated: false,
    tree,
  };

  it('accepts a valid result', () => {
    expect(SnapshotResultSchema.parse(result)).toEqual(result);
  });

  it('rejects a non-URL url', () => {
    expect(SnapshotResultSchema.safeParse({ ...result, url: 'nope' }).success).toBe(false);
  });

  it('rejects a non-ISO capturedAt', () => {
    expect(SnapshotResultSchema.safeParse({ ...result, capturedAt: 'today' }).success).toBe(false);
  });

  it('rejects a missing tree', () => {
    const { tree: _tree, ...rest } = result;
    expect(SnapshotResultSchema.safeParse(rest).success).toBe(false);
  });
});

describe('snapshot caps', () => {
  it('exports the agreed limits', () => {
    expect(SNAPSHOT_MAX_NODES).toBe(1500);
    expect(SNAPSHOT_NAME_MAX_CHARS).toBe(120);
  });
});
