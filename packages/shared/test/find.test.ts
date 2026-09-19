import { describe, expect, it } from 'vitest';
import { FIND_MAX_MATCHES, findNodes, originOf, type SnapshotNode } from '@ctr/shared';

const tree: SnapshotNode = {
  ref: 'n0',
  role: 'document',
  name: 'Login page',
  children: [
    {
      ref: 'n1',
      role: 'navigation',
      name: '',
      children: [{ ref: 'n2', role: 'link', name: 'Help', href: 'https://x.example/login-help' }],
    },
    { ref: 'n3', role: 'button', name: 'LOGIN' },
    { ref: 'n4', role: 'textbox', name: 'User', value: 'my-login-name' },
    { ref: 'n5', role: 'text', name: 'Unrelated content' },
  ],
};

describe('findNodes', () => {
  it('matches case-insensitively across name, value, and href', () => {
    const { matches, total } = findNodes(tree, 'login');
    expect(total).toBe(4); // document name, link href, button name, textbox value
    expect(matches.map((m) => m.ref)).toEqual(['n0', 'n2', 'n3', 'n4']);
  });

  it('restricts to an exact role when given', () => {
    const { matches, total } = findNodes(tree, 'login', 'button');
    expect(total).toBe(1);
    expect(matches[0]).toMatchObject({ ref: 'n3', role: 'button', name: 'LOGIN' });
  });

  it('strips children from matches (flat result lines)', () => {
    const { matches } = findNodes(tree, 'login page');
    expect(matches[0]).not.toHaveProperty('children');
  });

  it('caps matches at FIND_MAX_MATCHES but reports the true total', () => {
    const wide: SnapshotNode = {
      ref: 'n0',
      role: 'document',
      name: 'x',
      children: Array.from({ length: 40 }, (_, i) => ({
        ref: `n${i + 1}`,
        role: 'link',
        name: `x ${i}`,
      })),
    };
    const { matches, total } = findNodes(wide, 'x');
    expect(total).toBe(41);
    expect(matches).toHaveLength(FIND_MAX_MATCHES);
  });

  it('an empty query matches everything (useful with a role filter)', () => {
    expect(findNodes(tree, '', 'link').total).toBe(1);
  });
});

describe('originOf', () => {
  it('returns the origin for http(s) URLs and null for everything else', () => {
    expect(originOf('https://app.example.com/deep/path?q=1')).toBe('https://app.example.com');
    expect(originOf('http://localhost:3000/x')).toBe('http://localhost:3000');
    expect(originOf('chrome://extensions')).toBeNull();
    expect(originOf('about:blank')).toBeNull();
    expect(originOf('not a url')).toBeNull();
    expect(originOf(undefined)).toBeNull();
  });
});
