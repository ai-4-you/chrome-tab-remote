import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AuditLog } from '../src/audit-log.js';

let dir: string;

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('AuditLog', () => {
  it('appends one JSONL line per entry, creating the directory on first write', () => {
    dir = path.join(mkdtempSync(path.join(tmpdir(), 'ctr-audit-')), 'nested');
    const log = new AuditLog(dir);
    log.append({ ts: 1, type: 'grant_created', grantId: 'g1' });
    log.append({ ts: 2, type: 'tool_call', tool: 'tab_snapshot', ok: true });
    const lines = readFileSync(log.filePath, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toEqual({ ts: 1, type: 'grant_created', grantId: 'g1' });
  });

  it('rotates to .1 once the size cap is exceeded (one previous generation kept)', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'ctr-audit-'));
    const log = new AuditLog(dir, 200); // tiny cap for the test
    for (let i = 0; i < 10; i++) {
      log.append({ ts: i, type: 'tool_call', tool: 'tab_snapshot', ok: true });
    }
    expect(existsSync(`${log.filePath}.1`)).toBe(true);
    // The active file was restarted: it stays bounded near the cap instead of
    // holding all 10 entries. (Exactly ONE previous generation is kept by
    // design — with many rotations, older generations are discarded.)
    const active = readFileSync(log.filePath, 'utf8');
    expect(active.length).toBeLessThan(300);
    expect(active.trim().split('\n').length).toBeLessThan(10);
    // The newest entry is always in the active file.
    expect(active).toContain('"ts":9');
  });
});
