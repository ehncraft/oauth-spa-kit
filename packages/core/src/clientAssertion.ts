import { signJwt } from "./jwt.js";
import { generateRandomString } from "./pkce.js";
import type { ClientAuthentication } from "./types.js";

/**
 * RFC 7523 `private_key_jwt` client assertion -- the form params to attach
 * alongside `client_id` when authenticating to the token endpoint or the
 * PAR endpoint. This is the *only* client authentication method this kit
 * supports; there is no client_secret fallback (see the comment on
 * `ClientAuthentication` in types.ts for why).
 *
 * `audience` MUST be the authorization server's issuer identifier
 * ([RFC 8414](https://www.rfc-editor.org/rfc/rfc8414)) as its sole value --
 * per [draft-ietf-oauth-rfc7523bis](https://datatracker.ietf.org/doc/draft-ietf-oauth-rfc7523bis/)
 * section 4, which updates RFC 7523 specifically to close an audience
 * injection vulnerability (disclosed January 2025): a token-endpoint URL
 * (the older, now-superseded convention) or any other endpoint-specific
 * value MUST NOT be used, and a compliant AS MUST reject an assertion that
 * doesn't carry its issuer identifier as the sole `aud`. This kit's own
 * callers (`packages/server/src/handlers.ts`) always pass the discovery
 * document's `issuer` for this reason. If an AS rejects a valid assertion
 * with an audience error, the AS is non-compliant with the current spec --
 * `audience` here is deliberately not defaulted so a caller integrating
 * with such an AS still has to pass a value explicitly, rather than this
 * kit silently reintroducing an obsolete pattern.
 *
 * The JWT header is also explicitly typed `client-authentication+jwt`,
 * rfc7523bis section 3.2's recommended (SHOULD) explicit type for this
 * assertion class -- RFC 8725 section 3.11 explicit typing, applied here to
 * rule out cross-JWT confusion (this token being mistaken for, say, an
 * access token or an `id_token`). The spec itself says a server SHOULD NOT
 * reject an untyped assertion for backward compatibility, but some AS's
 * enforce it as a MUST; setting it unconditionally costs nothing and is
 * forward-compatible either way.
 */
export async function buildClientAssertionParams(
  clientId: string,
  clientAuth: ClientAuthentication,
  audience: string,
): Promise<Record<string, string>> {
  const now = Math.floor(Date.now() / 1000);
  const lifetimeSeconds = clientAuth.assertionLifetimeSeconds ?? 60;

  const assertion = await signJwt({
    header: { typ: "client-authentication+jwt", ...(clientAuth.keyId ? { kid: clientAuth.keyId } : {}) },
    payload: {
      iss: clientId,
      sub: clientId,
      aud: audience,
      jti: generateRandomString(16),
      iat: now,
      exp: now + lifetimeSeconds,
    },
    privateKey: clientAuth.privateKey,
    alg: clientAuth.alg ?? "ES256",
  });

  return {
    client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: assertion,
  };
}
