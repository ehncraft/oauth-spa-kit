import type { AuthenticatedUser, SerializedDpopKeyPair, TokenSet } from "@oauth-spa-kit/core";
import { sealJson, unsealJson } from "./crypto.js";
import { parseCookies, serializeCookie, expireCookie } from "./cookies.js";

export interface StoredSession {
  tokens: TokenSet;
  user: AuthenticatedUser;
  /** The exact key pair the tokens are DPoP-bound to -- reused for every refresh. Absent only if `config.oauth.dpop === false`. */
  dpopKeyPair?: SerializedDpopKeyPair;
  /** This device's friendly label ("Chrome on macOS"), parsed from the callback request's User-Agent at sign-in. */
  device?: string;
}

/**
 * A pluggable server-side backing store for session data (Redis, Cloudflare KV, unstorage,
 * whatever the consumer already runs) -- entirely optional. Deliberately minimal (three methods,
 * no framework/runtime assumptions) so it works unmodified on Node, Cloudflare Workers, Deno, or
 * Vercel Edge, the same portability goal `sealJson`/`unsealJson` already have.
 */
export interface SessionStore {
  /** Fetch the sealed session payload previously stored under this id, or `null` if missing/expired/evicted. */
  get(sessionId: string): Promise<string | null>;
  /** Persist the sealed payload under this id. `maxAgeSeconds` is the same TTL the cookie itself uses -- pass it through to your store's own expiry (e.g. Redis `EX`). */
  set(sessionId: string, sealedPayload: string, maxAgeSeconds: number): Promise<void>;
  /** Remove the entry for this id (logout, or a rejected liveness check) -- must not throw for an id that's already gone. */
  delete(sessionId: string): Promise<void>;
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
  /**
   * Optional server-side session store. When provided, the cookie carries only a random opaque
   * session id (itself still meaningless without store access) and the actual `StoredSession`
   * (tokens, DPoP key pair, user claims, device label) lives in `store` instead, keyed by that
   * id -- the cookie's size no longer grows with token/claims size. Omit to keep the original
   * fully-self-contained sealed-cookie behavior (still the default: no store to wire up for a
   * consumer that doesn't need one).
   */
  store?: SessionStore;
}

const DEFAULTS = { cookieName: "__session", maxAgeSeconds: 30 * 24 * 60 * 60 };

export async function readSession(request: Request, config: SessionConfig): Promise<StoredSession | null> {
  const cookieName = config.cookieName ?? DEFAULTS.cookieName;
  const raw = parseCookies(request)[cookieName];
  if (!raw) return null;

  if (config.store) {
    const sealed = await config.store.get(raw);
    if (!sealed) return null;
    return unsealJson<StoredSession>(sealed, config.password);
  }

  return unsealJson<StoredSession>(raw, config.password);
}

/**
 * @param previousRequest When re-writing a session that already exists (e.g. after a token
 * refresh), pass the *incoming* request so a store-backed session can delete the just-rotated-out
 * entry under its old id -- otherwise every refresh would mint a new store entry and orphan the
 * old one to expire via TTL alone instead of being cleaned up immediately. Omit for a brand-new
 * session (login callback) where there is no previous entry to clean up. Ignored when no store
 * is configured (the cookie itself is simply overwritten either way).
 */
export async function writeSessionHeader(
  session: StoredSession,
  config: SessionConfig,
  previousRequest?: Request,
): Promise<string> {
  const sealed = await sealJson(session, config.password);
  const maxAgeSeconds = config.maxAgeSeconds ?? DEFAULTS.maxAgeSeconds;
  const cookieName = config.cookieName ?? DEFAULTS.cookieName;

  if (config.store) {
    const sessionId = crypto.randomUUID();
    await config.store.set(sessionId, sealed, maxAgeSeconds);
    if (previousRequest) {
      await deleteStoredSession(previousRequest, config);
    }
    return serializeCookie(cookieName, sessionId, { maxAgeSeconds });
  }

  return serializeCookie(cookieName, sealed, { maxAgeSeconds });
}

export function clearSessionHeader(config: SessionConfig): string {
  return expireCookie(config.cookieName ?? DEFAULTS.cookieName);
}

/**
 * Removes this request's session from `config.store`, if configured -- so a logout (or a
 * rejected liveness check) invalidates the session immediately server-side, rather than only
 * once the store's own TTL catches up. Safe to call unconditionally alongside
 * `clearSessionHeader` regardless of whether a store is actually configured, whether the
 * request has a session cookie at all, or whether the store has already evicted the entry --
 * a no-op in every one of those cases, never an error.
 */
export async function deleteStoredSession(request: Request, config: SessionConfig): Promise<void> {
  if (!config.store) return;

  const cookieName = config.cookieName ?? DEFAULTS.cookieName;
  const sessionId = parseCookies(request)[cookieName];
  if (!sessionId) return;

  await config.store.delete(sessionId);
}
