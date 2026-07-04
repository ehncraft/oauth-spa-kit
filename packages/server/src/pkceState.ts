import type { SerializedDpopKeyPair } from "@oauth-spa-kit/core";
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
  /**
   * Generated at login time (not callback time) so its thumbprint can be
   * sent as `dpop_jkt` in the (pushed) authorization request, binding the
   * authorization code itself to this key -- RFC 9449 section 10. The same
   * key pair is then reused for the token exchange and carried into the
   * session for every subsequent refresh (a DPoP-bound refresh token must
   * be renewed with the key that obtained it).
   */
  dpopKeyPair?: SerializedDpopKeyPair;
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
