import { z } from 'zod';
import { GrantSchema } from './grant.js';
import { ToolErrorSchema } from './errors.js';

/** MCP tool names exposed by the host; bridged 1:1 over native messaging. */
export const TOOL_NAMES = ['tab_snapshot', 'tab_read', 'list_grants'] as const;
export const ToolNameSchema = z.enum(TOOL_NAMES);
export type ToolName = z.infer<typeof ToolNameSchema>;

/** host -> extension: request execution of one tool call. */
export const ToolCallRequestSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('toolCall'),
  tool: ToolNameSchema,
  params: z.record(z.unknown()),
});
export type ToolCallRequest = z.infer<typeof ToolCallRequestSchema>;

/** extension -> host: result for a previously received toolCall (matched by id). */
export const ToolResultSchema = z.union([
  z.object({
    id: z.string().min(1),
    kind: z.literal('toolResult'),
    ok: z.literal(true),
    result: z.unknown(),
  }),
  z.object({
    id: z.string().min(1),
    kind: z.literal('toolResult'),
    ok: z.literal(false),
    error: ToolErrorSchema,
  }),
]);
export type ToolResult = z.infer<typeof ToolResultSchema>;

/** Result shape of the list_grants tool. */
export const GrantListResultSchema = z.object({
  grants: z.array(GrantSchema),
});
export type GrantListResult = z.infer<typeof GrantListResultSchema>;

/** extension -> host: current grant list (sent on connect and on every change). */
export const GrantsChangedSchema = z.object({
  kind: z.literal('grantsChanged'),
  grants: z.array(GrantSchema),
});
export type GrantsChanged = z.infer<typeof GrantsChangedSchema>;

/** One audit trail entry (ring buffer in the extension, JSONL on the host). */
export const AuditEntrySchema = z.object({
  /** Epoch milliseconds. */
  ts: z.number().int().nonnegative(),
  /** Lifecycle or tool event type, e.g. 'grant_created', 'tool_call'. */
  type: z.string().min(1),
  grantId: z.string().optional(),
  tool: z.string().optional(),
  ok: z.boolean().optional(),
  detail: z.string().optional(),
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

/** extension -> host: forward one audit entry for JSONL persistence. */
export const AuditEventSchema = z.object({
  kind: z.literal('audit'),
  entry: AuditEntrySchema,
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;

/** Any message crossing the native-messaging boundary. */
export const NativeMessageSchema = z.union([
  ToolCallRequestSchema,
  ToolResultSchema,
  GrantsChangedSchema,
  AuditEventSchema,
]);
export type NativeMessage = z.infer<typeof NativeMessageSchema>;
