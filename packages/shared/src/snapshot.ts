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
  children?: SnapshotNode[];
}

export const SnapshotNodeSchema: z.ZodType<SnapshotNode> = z.lazy(() =>
  z.object({
    ref: z.string().regex(/^n\d+$/),
    role: z.string().min(1),
    name: z.string(),
    value: z.string().optional(),
    children: z.array(SnapshotNodeSchema).optional(),
  }),
);

/** Cap on nodes per snapshot; beyond this the result is marked truncated. */
export const SNAPSHOT_MAX_NODES = 1500;

/** Max characters for a node's accessible name in the snapshot. */
export const SNAPSHOT_NAME_MAX_CHARS = 120;

/**
 * Max characters returned by tab_read. Keeps the toolResult frame safely under
 * the host's 1 MB native-messaging frame budget (headroom for the JSON
 * envelope and multi-byte UTF-8).
 */
export const READ_TEXT_MAX_CHARS = 200_000;

export const SnapshotResultSchema = z.object({
  url: z.string().url(),
  title: z.string(),
  /** ISO-8601 timestamp of capture. */
  capturedAt: z.string().datetime(),
  truncated: z.boolean(),
  tree: SnapshotNodeSchema,
});
export type SnapshotResult = z.infer<typeof SnapshotResultSchema>;
