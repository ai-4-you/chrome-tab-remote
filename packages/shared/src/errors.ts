import { z } from 'zod';

/** All protocol-level error codes used across extension <-> host <-> MCP. */
export const ERROR_CODES = [
  'no_grant',
  'grant_expired',
  'grant_suspended',
  'grant_revoked',
  'unknown_ref',
  'stale_ref',
  'invalid_target',
  'observe_only',
  'approval_denied',
  'approval_timeout',
  'busy',
  'tab_unreachable',
  'timeout',
  'screenshot_not_allowed',
  'tab_not_visible',
  'screenshot_too_large',
  'screenshot_capture_failed',
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
  stale_ref:
    'This ref is from an OLDER snapshot; the page has been re-captured since. Call ' +
    'tab_snapshot again and target a ref from the fresh result — never act on stale refs.',
  invalid_target:
    'The element cannot perform this action (wrong element kind, missing option, or a ' +
    'protected field). Take a fresh tab_snapshot and check the element role and options.',
  observe_only:
    'The grant is observe-only; actions are not authorized. Ask the user to revoke and ' +
    "re-grant the tab with 'allow actions' enabled in the side panel if acting is wanted.",
  approval_denied:
    'The user DECLINED this action in the side panel. Do not retry the same action; ask ' +
    'the user what they would like to do instead.',
  approval_timeout:
    'The approval request expired without a user decision. Ask the user to keep the side ' +
    'panel open and watch for the approval card, then retry if the action is still wanted.',
  busy:
    'Another request is already awaiting the user in the side panel. Wait a few seconds ' +
    'for it to resolve, then retry.',
  tab_unreachable:
    'The granted tab did not respond. Ask the user to check the tab is still open and ' +
    'fully loaded (reload if needed), then retry.',
  timeout:
    'The extension did not answer in time. Ask the user to check the side panel shows ' +
    "'Native host: connected', then retry.",
  screenshot_not_allowed:
    'Viewport screenshots are not authorized for this grant. Ask the user to enable ' +
    "'Allow ViewportScreenshot' in the side panel for this tab, then retry.",
  tab_not_visible:
    'The granted tab is not the active tab in its window, so no pixels were captured. ' +
    'Ask the user to focus the granted tab, then retry.',
  screenshot_too_large:
    'The viewport image exceeds the safe transfer limit and was not sent. Ask the user ' +
    'to reduce browser zoom or resize the window, then retry.',
  screenshot_capture_failed:
    'Chrome did not permit this viewport capture. Ask the user to focus the granted tab and ' +
    'click the Chrome Tab Remote toolbar action on it, then retry. Restricted Chrome pages cannot be captured.',
};
