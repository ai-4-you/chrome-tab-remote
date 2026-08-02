// Runtime host permissions. The side panel requests the granted origin's
// permission inside the user's click gesture (chrome.permissions.request is
// gesture-gated); the background drops it again whenever the grant is torn
// down so the extension's footprint stays exactly one origin at a time.
export function originPattern(origin: string): string {
  return `${origin}/*`;
}

/**
 * Best-effort removal — never throws. A lingering optional permission is a
 * hygiene issue, not an access hole: without a usable grant no tool call
 * reaches the tab (router validates before every call).
 */
export async function dropOriginPermission(origin: string): Promise<void> {
  try {
    await chrome.permissions.remove({ origins: [originPattern(origin)] });
  } catch {
    // e.g. permission was never granted or already removed — nothing to do
  }
}
