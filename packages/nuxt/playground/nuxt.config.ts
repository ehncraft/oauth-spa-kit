// Dev/typecheck playground -- this is what `nuxi prepare` runs against to
// generate `.nuxt/tsconfig.*.json`, which the package's own tsconfig.json
// references so `#imports` resolves (see the module comment there, and the
// README's Status section). By default this is not a real IdP integration:
// the discovery document is a static stand-in so `nuxi dev`/`prepare` never
// needs network access, and the key pair is generated fresh on every start.
//
// To actually click through `useAuth().login()` against a real local IdP
// (e.g. to confirm it lands on that server's login UI), set
// PLAYGROUND_OAUTH_AUTHORITY (+ the client vars below) and re-run `dev`:
//
//   PLAYGROUND_OAUTH_AUTHORITY=https://localhost:7024 \
//   PLAYGROUND_OAUTH_CLIENT_ID=rd_plt_dev_admin-xbihycvq \
//   PLAYGROUND_OAUTH_PRIVATE_KEY_JWK='{"kty":"EC","crv":"P-256","x":"...","y":"...","d":"...","kid":"..."}' \
//   PLAYGROUND_SESSION_PASSWORD='<a real >=32 char secret>' \
//   NODE_TLS_REJECT_UNAUTHORIZED=0 \
//     pnpm --filter=@oauth-spa-kit/nuxt run dev
//
// The JWK must be the private key half of a key pair already registered as
// that client's JWKS on the IdP (a `private_key_jwt` client can't just show
// up with an unrecognized key). NODE_TLS_REJECT_UNAUTHORIZED=0 is only
// needed for a self-signed local dev cert -- never set that against a real
// deployment.
const realAuthority = process.env.PLAYGROUND_OAUTH_AUTHORITY;

// The default below is a public placeholder checked into this repo -- fine
// for the fully-offline default (nothing it seals is real), but sealing
// real session cookies with a secret anyone can read on GitHub is a real
// vulnerability. Required as soon as a real IdP is in play.
const sessionPassword = process.env.PLAYGROUND_SESSION_PASSWORD;
if (realAuthority && !sessionPassword) {
  throw new Error(
    "PLAYGROUND_OAUTH_AUTHORITY is set (testing against a real IdP) but PLAYGROUND_SESSION_PASSWORD is missing -- the default session password is a public placeholder and must not be used once real user sessions are involved.",
  );
}

// A plain JWK, not a CryptoKey -- the module's config only carries
// JSON-serializable values through Nuxt's runtimeConfig; see the doc
// comment on ModuleClientAuthentication in ../src/module.ts.
let privateKeyJwk: JsonWebKey;
let keyId: string | undefined;

if (realAuthority) {
  const jwkJson = process.env.PLAYGROUND_OAUTH_PRIVATE_KEY_JWK;
  if (!jwkJson) {
    throw new Error(
      "PLAYGROUND_OAUTH_AUTHORITY is set but PLAYGROUND_OAUTH_PRIVATE_KEY_JWK is missing -- both are required to test against a real IdP.",
    );
  }
  const parsedJwk: JsonWebKey & { kid?: string } = JSON.parse(jwkJson);
  privateKeyJwk = parsedJwk;
  keyId = parsedJwk.kid;
} else {
  const { privateKey } = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
  privateKeyJwk = await crypto.subtle.exportKey("jwk", privateKey);
}

export default defineNuxtConfig({
  modules: ["../src/module"],
  oauthSpaKit: {
    oauth: {
      authority: realAuthority ?? "https://playground-idp.example",
      clientId: process.env.PLAYGROUND_OAUTH_CLIENT_ID ?? "playground-client",
      clientAuthentication: { method: "private_key_jwt", privateKeyJwk, alg: "ES256", ...(keyId ? { keyId } : {}) },
      redirectUri: process.env.PLAYGROUND_OAUTH_REDIRECT_URI ?? "http://localhost:3000/auth/callback",
      postLogoutRedirectUri: process.env.PLAYGROUND_OAUTH_POST_LOGOUT_REDIRECT_URI ?? "http://localhost:3000",
      scope: process.env.PLAYGROUND_OAUTH_SCOPE ?? "openid profile email offline_access",
      // Real IdPs get their metadata from discovery (authority +
      // /.well-known/openid-configuration); the static stub only exists so
      // the offline default never needs network access.
      discoveryDocument: realAuthority
        ? undefined
        : {
            issuer: "https://playground-idp.example",
            authorization_endpoint: "https://playground-idp.example/authorize",
            token_endpoint: "https://playground-idp.example/token",
            pushed_authorization_request_endpoint: "https://playground-idp.example/par",
            jwks_uri: "https://playground-idp.example/jwks",
            end_session_endpoint: "https://playground-idp.example/logout",
          },
    },
    session: {
      // Public placeholder fallback -- only reached when realAuthority is
      // unset (the guard above requires a real PLAYGROUND_SESSION_PASSWORD
      // whenever a real IdP is configured).
      password: sessionPassword ?? "playground-only-not-a-real-secret-32ch",
    },
  },
  compatibilityDate: "2025-01-01",
});
