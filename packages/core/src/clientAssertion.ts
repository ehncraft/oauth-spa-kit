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
 * `audience` is conventionally the URL of the endpoint being authenticated
 * to (OIDC Core section 9); a few authorization servers expect the issuer
 * identifier instead regardless of which endpoint is called -- check your
 * AS's docs if it rejects the assertion with an audience error.
 */
export async function buildClientAssertionParams(
  clientId: string,
  clientAuth: ClientAuthentication,
  audience: string,
): Promise<Record<string, string>> {
  const now = Math.floor(Date.now() / 1000);
  const lifetimeSeconds = clientAuth.assertionLifetimeSeconds ?? 60;

  const assertion = await signJwt({
    header: clientAuth.keyId ? { kid: clientAuth.keyId } : {},
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
