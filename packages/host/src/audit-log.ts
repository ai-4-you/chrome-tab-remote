import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { AuditEntry } from '@ctr/shared';

export const AUDIT_FILE_NAME = 'audit.jsonl';
/** Rotate the JSONL once it exceeds this size; one previous generation is kept. */
export const AUDIT_MAX_BYTES = 10 * 1024 * 1024;

/** Data directory: CTR_DATA_DIR if set, else ~/.chrome-tab-remote. */
export function resolveDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.CTR_DATA_DIR;
  if (fromEnv && fromEnv.trim().length > 0) {
    return fromEnv;
  }
  return path.join(homedir(), '.chrome-tab-remote');
}

/**
 * Append-only JSONL audit log; creates the data directory on first write.
 * Size-bounded: past AUDIT_MAX_BYTES the file rotates to `audit.jsonl.1`
 * (one previous generation kept) so months of use cannot grow disk unbounded.
 */
export class AuditLog {
  readonly dir: string;
  readonly filePath: string;
  private dirReady = false;

  constructor(
    dir: string = resolveDataDir(),
    private readonly maxBytes: number = AUDIT_MAX_BYTES,
  ) {
    this.dir = dir;
    this.filePath = path.join(dir, AUDIT_FILE_NAME);
  }

  private rotateIfNeeded(): void {
    try {
      if (statSync(this.filePath).size < this.maxBytes) return;
      renameSync(this.filePath, `${this.filePath}.1`);
    } catch {
      // File missing (first write) or rotation raced — appending still works.
    }
  }

  append(entry: AuditEntry): void {
    if (!this.dirReady) {
      mkdirSync(this.dir, { recursive: true });
      this.dirReady = true;
    }
    this.rotateIfNeeded();
    appendFileSync(this.filePath, `${JSON.stringify(entry)}\n`, 'utf8');
  }
}
