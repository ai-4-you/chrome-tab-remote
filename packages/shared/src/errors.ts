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

/**
 * Recovery instruction per error code — appended to MCP error results so an
 * agent knows the concrete next step (usually: what to ask the user to do)
 * instead of dead-ending on a diagnosis.
 */
export const ERROR_RECOVERY: Record<ErrorCode, string> = {
  no_grant:
    'There is no active grant. Ask the user to open the Chrome Tab Remote side panel ' +
    "on the tab they want to share and click 'Grant observe access', then retry.",
  grant_expired:
    'The grant reached its 30-minute lifetime. Ask the user to grant the tab again ' +
    'in the side panel, then retry.',
  grant_suspended:
    'The granted tab navigated to a different website, which suspends access. Ask the ' +
    "user to click 'Re-confirm' in the side panel (it shows the new site), then retry.",
  grant_revoked:
    'The user revoked access or the granted tab was closed. Ask the user to grant a ' +
    'tab again in the side panel if access is still wanted.',
  unknown_ref:
    'This ref is not part of the latest snapshot (the page may have changed). Call ' +
    'tab_snapshot again and use a ref from the fresh result.',
  tab_unreachable:
    'The granted tab did not respond. Ask the user to check the tab is still open and ' +
    'fully loaded (reload if needed), then retry.',
  timeout:
    'The extension did not answer in time. Ask the user to check the side panel shows ' +
    "'Native host: connected', then retry.",
};
