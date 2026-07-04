import { sealJson, unsealJson } from "./crypto";
import { parseCookies, serializeCookie, expireCookie } from "./cookies";

/**
 * Holds the PKCE verifier + state + nonce for the ~seconds it takes the
 * browser to round-trip through the IdP. A short-lived signed cookie
 * instead of server-side memory keeps the BFF stateless (works fine behind
 * a load balancer with no sticky sessions / shared store).
 */
export interface PkceState {
  codeVerifier: string;
  state: string;
  nonce: string;
  returnTo: string;
}

const COOKIE_NAME = "__oauth_pkce";
const MAX_AGE_SECONDS = 5 * 60;

export async function writePkceStateHeader(pkce: PkceState, password: string): Promise<string> {
  const sealed = await sealJson(pkce, password);
  return serializeCookie(COOKIE_NAME, sealed, { maxAgeSeconds: MAX_AGE_SECONDS });
}

export async function readPkceState(request: Request, password: string): Promise<PkceState | null> {
  const raw = parseCookies(request)[COOKIE_NAME];
  if (!raw) return null;
  return unsealJson<PkceState>(raw, password);
}

export function clearPkceStateHeader(): string {
  return expireCookie(COOKIE_NAME);
}
