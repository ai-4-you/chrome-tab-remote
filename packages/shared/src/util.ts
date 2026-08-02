// Small pure helpers shared across extension entrypoints and the host.

/** http(s) origin of a URL, or null for anything ungrantable (chrome://, about:, …). */
export function originOf(url: string | undefined): string | null {
  if (!url || !/^https?:/i.test(url)) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}
