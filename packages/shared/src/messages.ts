import { z } from 'zod';
import { GrantSchema } from './grant.js';
import { ToolErrorSchema } from './errors.js';
import { SnapshotNodeSchema, SnapshotResultSchema } from './snapshot.js';

/** MCP tool names exposed by the host; bridged 1:1 over native messaging. */
export const TOOL_NAMES = [
  'tab_snapshot',
  'tab_read',
  'tab_find',
  'list_grants',
  'request_grant',
  'tab_click',
  'tab_fill',
  'tab_select',
  'tab_plan',
] as const;
export const ToolNameSchema = z.enum(TOOL_NAMES);
export type ToolName = z.infer<typeof ToolNameSchema>;

/** The mutating tools; every one requires an 'act' grant AND user approval (per plan). */
export const ACT_TOOL_NAMES = ['tab_click', 'tab_fill', 'tab_select', 'tab_plan'] as const;
export type ActToolName = (typeof ACT_TOOL_NAMES)[number];
export function isActTool(tool: ToolName): tool is ActToolName {
  return (ACT_TOOL_NAMES as readonly string[]).includes(tool);
}

/**
 * One step of an action plan. Single-action tools are 1-step plans internally —
 * one gate, one approval card, one result shape (C-10).
 */
export const PlanStepSchema = z.object({
  kind: z.enum(['click', 'fill', 'select']),
  ref: z.string().regex(/^n\d+$/),
  /** fill only. */
  text: z.string().optional(),
  /** select only. */
  value: z.string().optional(),
});
export type PlanStep = z.infer<typeof PlanStepSchema>;
export const PLAN_MAX_STEPS = 10;

/** DOM-settle heuristic: "quiet" = no mutations for SETTLE_QUIET_MS, capped at SETTLE_MAX_MS. */
export const SETTLE_QUIET_MS = 250;
export const SETTLE_MAX_MS = 2000;

/**
 * Post-action page confidence — always reported honestly (C-11): 'settled'
 * (mutation-quiet), 'still-changing' (cap hit while mutating), 'interrupted'
 * (navigation/reload killed execution; completed-step count unknown).
 */
export const PAGE_STATES = ['settled', 'still-changing', 'interrupted'] as const;
export type PageState = (typeof PAGE_STATES)[number];

/**
 * Approval timing: the extension waits APPROVAL_TIMEOUT_MS for the user's
 * decision; the host waits ACT_TOOL_TIMEOUT_MS for the whole call. The
 * extension timeout is intentionally shorter so the agent gets the specific
 * approval_timeout error, not a generic bridge timeout.
 */
export const APPROVAL_TIMEOUT_MS = 110_000;
export const ACT_TOOL_TIMEOUT_MS = 120_000;

/** Result of one executed step. */
export const ActionResultSchema = z.object({
  action: z.enum(['click', 'fill', 'select']),
  ref: z.string().regex(/^n\d+$/),
  /** Short human description of the element acted on, e.g. 'button "Save"'. */
  target: z.string(),
  /** fill only: the text that was written. */
  text: z.string().optional(),
  /** select only: the option that ended up selected. */
  value: z.string().optional(),
});
export type ActionResult = z.infer<typeof ActionResultSchema>;

/**
 * Result of an executed plan (all act tools return this): the steps that ran,
 * the first failure if any, the honest page state, and a fresh post-settle
 * interactive snapshot so the agent re-orients without another round trip.
 */
export const PlanResultSchema = z.object({
  executed: z.array(ActionResultSchema),
  failedStep: z
    .object({
      index: z.number().int().nonnegative(),
      code: z.string(),
      message: z.string(),
    })
    .optional(),
  pageState: z.enum(PAGE_STATES),
  snapshot: SnapshotResultSchema.optional(),
});
export type PlanResult = z.infer<typeof PlanResultSchema>;

/** Result of tab_find: matching nodes from a FRESH snapshot (earlier refs go stale). */
export const FindResultSchema = z.object({
  url: z.string(),
  title: z.string(),
  total: z.number().int().nonnegative(),
  matches: z.array(SnapshotNodeSchema),
});
export type FindResult = z.infer<typeof FindResultSchema>;

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
  /** Tab the event concerns — powers the side panel's per-tab audit view. Absent for system events (native_connected, …). */
  tabId: z.number().int().nonnegative().optional(),
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
