import { z } from 'zod';

/**
 * One node of the accessibility-tree-like snapshot.
 * `ref` is stable within a single snapshot ("n1", "n2", ...) and is the only
 * handle tab_read accepts.
 */
export interface SnapshotNode {
  ref: string;
  role: string;
  name: string;
  value?: string;
  /** Absolute http(s) URL for link nodes; capped at SNAPSHOT_HREF_MAX_CHARS. */
  href?: string;
  /** combobox (<select>) only: choosable options as "label" or "label (value)"; capped. */
  options?: string[];
  children?: SnapshotNode[];
}

export const SnapshotNodeSchema: z.ZodType<SnapshotNode> = z.lazy(() =>
  z.object({
    ref: z.string().regex(/^n\d+$/),
    role: z.string().min(1),
    name: z.string(),
    value: z.string().optional(),
    href: z.string().optional(),
    options: z.array(z.string()).optional(),
    children: z.array(SnapshotNodeSchema).optional(),
  }),
);

/** Max <select> options listed per combobox node; more are cut with a trailing "…". */
export const SNAPSHOT_MAX_OPTIONS = 20;

/**
 * Snapshot filter: 'full' walks everything (text runs, structure, landmarks);
 * 'interactive' keeps only elements an agent could target (links, buttons,
 * form controls, menu/tab widgets) plus headings for orientation.
 */
export const SNAPSHOT_FILTERS = ['full', 'interactive'] as const;
export const SnapshotFilterSchema = z.enum(SNAPSHOT_FILTERS);
export type SnapshotFilter = z.infer<typeof SnapshotFilterSchema>;

/** Cap on nodes per snapshot; beyond this the result is marked truncated. */
export const SNAPSHOT_MAX_NODES = 1500;

/** Max characters for a node's accessible name in the snapshot. */
export const SNAPSHOT_NAME_MAX_CHARS = 120;

/** Max characters for a link node's href in the snapshot. */
export const SNAPSHOT_HREF_MAX_CHARS = 300;

/**
 * Max characters returned by tab_read. Keeps the toolResult frame safely under
 * the host's 1 MB native-messaging frame budget (headroom for the JSON
 * envelope and multi-byte UTF-8).
 */
export const READ_TEXT_MAX_CHARS = 200_000;

/** Result shape of tab_read as produced by the content script. */
export const TabReadResultSchema = z.object({
  ref: z.string().regex(/^n\d+$/),
  text: z.string(),
});
export type TabReadResult = z.infer<typeof TabReadResultSchema>;

export const SnapshotResultSchema = z.object({
  url: z.string().url(),
  title: z.string(),
  /** ISO-8601 timestamp of capture. */
  capturedAt: z.string().datetime(),
  truncated: z.boolean(),
  /** Which filter produced this snapshot; absent means 'full' (older captures). */
  filter: SnapshotFilterSchema.optional(),
  tree: SnapshotNodeSchema,
});
export type SnapshotResult = z.infer<typeof SnapshotResultSchema>;
