export function parseCookies(request: Request): Record<string, string> {
  const header = request.headers.get("cookie");
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

export interface CookieOptions {
  maxAgeSeconds?: number;
  path?: string;
  domain?: string;
}

/**
 * `HttpOnly` + `Secure` + `SameSite=Lax` always: the whole point of the BFF
 * pattern is that this value is never readable or writable from JS.
 * `Lax` (not `Strict`) so the cookie still rides along on the top-level
 * redirect back from the IdP after login.
 */
export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, "HttpOnly", "Secure", "SameSite=Lax", `Path=${options.path ?? "/"}`];
  if (options.maxAgeSeconds !== undefined) parts.push(`Max-Age=${options.maxAgeSeconds}`);
  if (options.domain) parts.push(`Domain=${options.domain}`);
  return parts.join("; ");
}

export function expireCookie(name: string, options: Pick<CookieOptions, "path" | "domain"> = {}): string {
  return serializeCookie(name, "", { ...options, maxAgeSeconds: 0 });
}
