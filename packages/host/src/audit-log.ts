import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { AuditEntry } from '@ctr/shared';

export const AUDIT_FILE_NAME = 'audit.jsonl';

/** Data directory: CTR_DATA_DIR if set, else ~/.chrome-tab-remote. */
export function resolveDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.CTR_DATA_DIR;
  if (fromEnv && fromEnv.trim().length > 0) {
    return fromEnv;
  }
  return path.join(homedir(), '.chrome-tab-remote');
}

/** Append-only JSONL audit log; creates the data directory on first write. */
export class AuditLog {
  readonly dir: string;
  readonly filePath: string;
  private dirReady = false;

  constructor(dir: string = resolveDataDir()) {
    this.dir = dir;
    this.filePath = path.join(dir, AUDIT_FILE_NAME);
  }

  append(entry: AuditEntry): void {
    if (!this.dirReady) {
      mkdirSync(this.dir, { recursive: true });
      this.dirReady = true;
    }
    appendFileSync(this.filePath, `${JSON.stringify(entry)}\n`, 'utf8');
  }
}
