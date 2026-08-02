import { randomUUID } from 'node:crypto';
import {
  NativeMessageSchema,
  type AuditEntry,
  type ErrorCode,
  type Grant,
  type ToolCallRequest,
  type ToolName,
} from '@ctr/shared';

/** How long a bridged toolCall may stay unanswered before it fails. */
export const DEFAULT_TOOL_TIMEOUT_MS = 15_000;

/** Error carrying a protocol error code, raised for failed/timed-out tool calls. */
export class ToolCallError extends Error {
  constructor(readonly code: ErrorCode, message: string) {
    super(message);
    this.name = 'ToolCallError';
  }
}

interface PendingCall {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export interface BridgeOptions {
  /** Transmit one host->extension request (native messaging framing lives outside). */
  send: (message: ToolCallRequest) => void;
  /** Persist one audit entry (JSONL sink). */
  auditSink?: (entry: AuditEntry) => void;
  timeoutMs?: number;
  /** Diagnostics only; must go to stderr in the real host. */
  log?: (line: string) => void;
}

/**
 * Bridges MCP tool calls to the extension over native messaging: keeps pending
 * toolCalls by id, tracks the latest grant list, and forwards audit events.
 * All inbound messages are schema-validated; invalid input is logged and
 * dropped — never crashes the host.
 */
export class Bridge {
  private readonly pending = new Map<string, PendingCall>();
  private grants: Grant[] = [];
  private readonly send: BridgeOptions['send'];
  private readonly auditSink?: BridgeOptions['auditSink'];
  private readonly timeoutMs: number;
  private readonly log: (line: string) => void;

  constructor(options: BridgeOptions) {
    this.send = options.send;
    this.auditSink = options.auditSink;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;
    this.log = options.log ?? (() => {});
  }

  /** Latest grant list reported by the extension (empty until first grantsChanged). */
  getGrants(): Grant[] {
    return [...this.grants];
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  /** Send one toolCall to the extension; resolves on matching toolResult, rejects on timeout. */
  callTool(tool: ToolName, params: Record<string, unknown>): Promise<unknown> {
    const id = randomUUID();
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new ToolCallError('timeout', `toolCall '${tool}' (${id}) timed out after ${this.timeoutMs} ms`));
      }, this.timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ id, kind: 'toolCall', tool, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(
          new ToolCallError(
            'tab_unreachable',
            `failed to send toolCall '${tool}': ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
    });
  }

  /** Handle one parsed inbound message from the extension. */
  handleMessage(raw: unknown): void {
    const parsed = NativeMessageSchema.safeParse(raw);
    if (!parsed.success) {
      this.log(`bridge: dropping invalid native message: ${parsed.error.issues[0]?.message ?? 'schema mismatch'}`);
      return;
    }
    const message = parsed.data;
    switch (message.kind) {
      case 'toolResult': {
        const pending = this.pending.get(message.id);
        if (!pending) {
          this.log(`bridge: toolResult for unknown id '${message.id}' ignored`);
          return;
        }
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.ok) {
          pending.resolve(message.result);
        } else {
          pending.reject(new ToolCallError(message.error.code, message.error.message));
        }
        return;
      }
      case 'grantsChanged': {
        this.grants = message.grants;
        return;
      }
      case 'audit': {
        try {
          this.auditSink?.(message.entry);
        } catch (error) {
          this.log(`bridge: audit sink failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        return;
      }
      case 'toolCall': {
        this.log(`bridge: unexpected toolCall from extension (id '${message.id}') dropped`);
        return;
      }
    }
  }

  /** Reject all pending calls (native messaging channel is gone). */
  dispose(): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new ToolCallError('tab_unreachable', `native messaging channel closed (pending call ${id})`));
    }
    this.pending.clear();
  }
}
