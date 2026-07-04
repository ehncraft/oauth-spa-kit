import type { AuthenticatedUser, TokenSet } from "@oauth-spa-kit/core";
import { sealJson, unsealJson } from "./crypto";
import { parseCookies, serializeCookie, expireCookie } from "./cookies";

export interface StoredSession {
  tokens: TokenSet;
  user: AuthenticatedUser;
}

export interface SessionConfig {
  /** >=32 char secret. Load from env (`OAUTH_SESSION_PASSWORD`); rotate by supporting two passwords during migration if you need zero-downtime rotation. */
  password: string;
  cookieName?: string;
  /**
   * Hard ceiling on the *session* cookie's own lifetime, independent of the
   * access token's `expiresAt`. Should comfortably exceed your refresh
   * token's lifetime -- the cookie merely carries the (still-expiring)
   * refresh token; it isn't itself a trust boundary extension.
   */
  maxAgeSeconds?: number;
}

const DEFAULTS = { cookieName: "__session", maxAgeSeconds: 30 * 24 * 60 * 60 };

export async function readSession(request: Request, config: SessionConfig): Promise<StoredSession | null> {
  const cookieName = config.cookieName ?? DEFAULTS.cookieName;
  const raw = parseCookies(request)[cookieName];
  if (!raw) return null;
  return unsealJson<StoredSession>(raw, config.password);
}

export async function writeSessionHeader(session: StoredSession, config: SessionConfig): Promise<string> {
  const sealed = await sealJson(session, config.password);
  return serializeCookie(config.cookieName ?? DEFAULTS.cookieName, sealed, {
    maxAgeSeconds: config.maxAgeSeconds ?? DEFAULTS.maxAgeSeconds,
  });
}

export function clearSessionHeader(config: SessionConfig): string {
  return expireCookie(config.cookieName ?? DEFAULTS.cookieName);
}
