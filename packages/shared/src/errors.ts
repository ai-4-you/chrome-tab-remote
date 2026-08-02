import { z } from 'zod';

/** All protocol-level error codes used across extension <-> host <-> MCP. */
export const ERROR_CODES = [
  'no_grant',
  'grant_expired',
  'grant_suspended',
  'grant_revoked',
  'unknown_ref',
  'tab_unreachable',
  'timeout',
] as const;

export const ErrorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ToolErrorSchema = z.object({
  code: ErrorCodeSchema,
  message: z.string(),
});
export type ToolError = z.infer<typeof ToolErrorSchema>;
