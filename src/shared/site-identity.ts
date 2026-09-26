export interface SiteIdentity {
  readonly domain: string;
  readonly origin: string;
}

/**
 * Converts a transient browser URL into the minimum site identity needed for
 * host-permission checks. It deliberately discards path, query, fragment and
 * port rather than exposing a full URL to callers or storage.
 */
export function siteIdentityFromUrl(value: unknown): SiteIdentity | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return { domain: url.hostname, origin: `${url.protocol}//${url.hostname}/*` };
  } catch {
    return undefined;
  }
}
