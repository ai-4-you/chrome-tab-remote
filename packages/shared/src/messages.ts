import { z } from 'zod';
import { GrantSchema } from './grant.js';
import { ToolErrorSchema } from './errors.js';
import { SnapshotNodeSchema } from './snapshot.js';

/** MCP tool names exposed by the host; bridged 1:1 over native messaging. */
export const TOOL_NAMES = [
  'tab_snapshot',
  'tab_read',
  'tab_read_many',
  'tab_find',
  'tab_screenshot_viewport',
  'list_grants',
  'request_grant',
  'tab_click',
  'tab_fill',
  'tab_select',
  'tab_scroll',
  'tab_plan',
] as const;
export const ToolNameSchema = z.enum(TOOL_NAMES);
export type ToolName = z.infer<typeof ToolNameSchema>;

/** The mutating tools; every one requires an 'act' grant AND user approval (per plan). */
export const ACT_TOOL_NAMES = ['tab_click', 'tab_fill', 'tab_select', 'tab_scroll', 'tab_plan'] as const;
export type ActToolName = (typeof ACT_TOOL_NAMES)[number];
export function isActTool(tool: ToolName): tool is ActToolName {
  return (ACT_TOOL_NAMES as readonly string[]).includes(tool);
}

/** Target of a step or result: a snapshot ref, or the literal 'page' (page-mode scroll). */
const REF_OR_PAGE = /^n\d+$|^page$/;

/**
 * One step of an action plan. Single-action tools are 1-step plans internally —
 * one gate, one approval card, one result shape (C-10).
 *
 * A deliberately FLAT object (not a discriminated union): a union would churn every
 * consumer (host re-validation, the router's z.array(PlanStepSchema), tests) for no
 * validation gain. Per-kind rules are enforced by the superRefine below; 'page' is a
 * legal ref value ONLY for a scroll step, because the host's tab_click/tab_fill/
 * tab_select input schemas accept only /^n\d+$/ and the content script's ref lookup
 * answers unknown_ref for anything that is not in the latest snapshot.
 */
export const PlanStepSchema = z
  .object({
    kind: z.enum(['click', 'fill', 'select', 'scroll']),
    /** Snapshot ref, or 'page' for a page-mode scroll. */
    ref: z.string().regex(REF_OR_PAGE),
    /** fill only. */
    text: z.string().optional(),
    /** select only. */
    value: z.string().optional(),
    /** scroll only. Required when ref === 'page' (see superRefine). */
    direction: z.enum(['down', 'up']).optional(),
    /** scroll only: page mode; defaults to SCROLL_DEFAULT_PIXELS. */
    pixels: z.number().int().min(1).max(10_000).optional(),
    /** scroll only, PAGE mode only; 'instant' is the default — smooth scroll breaks settle detection. */
    behavior: z.enum(['instant', 'auto']).optional(),
  })
  .superRefine((step, ctx) => {
    if (step.kind !== 'scroll') return;
    if (step.ref === 'page') {
      if (step.direction !== 'down' && step.direction !== 'up') {
        ctx.addIssue({
          code: 'custom',
          path: ['direction'],
          message: "Page-mode scroll requires direction: 'down' | 'up'.",
        });
      }
      return;
    }
    // Element mode brings the element into view; it has no direction and no
    // distance. Accepting them only to ignore them would let an agent believe it
    // asked for a bounded move, so the contract refuses them outright.
    if (step.direction !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['direction'],
        message: "direction applies to page mode only; an element ref scrolls into view.",
      });
    }
    if (step.pixels !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['pixels'],
        message: "pixels applies to page mode only; an element ref scrolls into view.",
      });
    }
    // Element mode scrolls into view instantly and has no settle wait, so its
    // metrics are read right after dispatch: 'auto' would only ever describe a
    // pre-animation layout. Same accepted-but-ignored trap as direction/pixels.
    if (step.behavior !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['behavior'],
        message: 'behavior applies to page mode only; an element ref scrolls into view instantly.',
      });
    }
  });
export type PlanStep = z.infer<typeof PlanStepSchema>;

/** Default page-mode scroll distance when the caller omits pixels. */
export const SCROLL_DEFAULT_PIXELS = 800;
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
export const ScrollMetricsSchema = z.object({
  scrollTop: z.number().int().nonnegative(),
  scrollHeight: z.number().int().nonnegative(),
  clientHeight: z.number().int().nonnegative(),
  atBottom: z.boolean(),
});
export type ScrollMetrics = z.infer<typeof ScrollMetricsSchema>;

export const ActionResultSchema = z.object({
  action: z.enum(['click', 'fill', 'select', 'scroll']),
  ref: z.string().regex(REF_OR_PAGE),
  /** Short human description of the element acted on, e.g. 'button "Save"'. */
  target: z.string(),
  /** fill only: the text that was written. */
  text: z.string().optional(),
  /** select only: the option that ended up selected. */
  value: z.string().optional(),
  /** scroll only: measured on the element that actually scrolled. */
  scrollMetrics: ScrollMetricsSchema.optional(),
  /**
   * page-mode scroll only: settle state observed AFTER the scroll settled, so
   * lazy-loaded growth is included. Internal to the extension — ctrPlan uses it as
   * the authoritative pageState and strips it before the result leaves the tab.
   */
  pageSettled: z.boolean().optional(),
});

export type ActionResult = z.infer<typeof ActionResultSchema>;

/**
 * Result of an executed plan (all act tools return this): the steps dispatched,
 * the first failure if any, and the honest page state. This is a receipt, not
 * an observation; callers use tab_snapshot or tab_find to inspect the result.
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
});
export type PlanResult = z.infer<typeof PlanResultSchema>;

/** One tab_read_many result; failures are inline so no requested ref is dropped. */
export const TabReadManyItemSchema = z.object({
  ref: z.string().regex(/^n\d+$/),
  ok: z.boolean(),
  entry: z
    .object({
      text: z.string(),
      /** True when this entry was cut by the batch aggregate cap. */
      truncated: z.boolean().optional(),
    })
    .optional(),
  error: ToolErrorSchema.optional(),
});
export type TabReadManyItem = z.infer<typeof TabReadManyItemSchema>;

export const TabReadManyResultSchema = z.object({
  results: z.array(TabReadManyItemSchema),
});
export type TabReadManyResult = z.infer<typeof TabReadManyResultSchema>;

/** Result of tab_find: matching nodes from the latest snapshot (refs remain valid). */
export const FindResultSchema = z.object({
  url: z.string(),
  title: z.string(),
  total: z.number().int().nonnegative(),
  matches: z.array(SnapshotNodeSchema),
});
export type FindResult = z.infer<typeof FindResultSchema>;

/** A bounded JPEG viewport image, encoded for native messaging and MCP image content. */
export const ViewportScreenshotResultSchema = z.object({
  mimeType: z.literal('image/jpeg'),
  data: z.string().min(1),
  url: z.string().url(),
  title: z.string(),
});
export type ViewportScreenshotResult = z.infer<typeof ViewportScreenshotResultSchema>;

/** host -> extension: request execution of one tool call. */
export const ToolCallRequestSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('toolCall'),
  tool: ToolNameSchema,
  params: z.record(z.string(), z.unknown()),
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

/**
 * host -> extension: sent once on startup so the panel can show WHERE this
 * browser's MCP endpoint lives (ports differ per browser, E-5).
 */
export const HostInfoSchema = z.object({
  kind: z.literal('hostInfo'),
  mcpUrl: z.string().url(),
});
export type HostInfo = z.infer<typeof HostInfoSchema>;

/** Any message crossing the native-messaging boundary. */
export const NativeMessageSchema = z.union([
  ToolCallRequestSchema,
  ToolResultSchema,
  GrantsChangedSchema,
  AuditEventSchema,
  HostInfoSchema,
]);
export type NativeMessage = z.infer<typeof NativeMessageSchema>;
