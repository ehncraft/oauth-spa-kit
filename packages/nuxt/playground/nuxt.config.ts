// Dev/typecheck playground only -- this is what `nuxi prepare` runs
// against to generate `.nuxt/tsconfig.*.json`, which the package's own
// tsconfig.json references so `#imports` resolves (see the module comment
// there, and the README's Status section). Not a real IdP integration: the
// discovery document is a static stand-in so `nuxi dev`/`prepare` never
// needs network access, and the key pair is generated fresh on every
// start, so nothing here is a usable login flow.
const { privateKey } = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);

export default defineNuxtConfig({
  modules: ["../src/module"],
  oauthSpaKit: {
    oauth: {
      authority: "https://playground-idp.example",
      clientId: "playground-client",
      clientAuthentication: { method: "private_key_jwt", privateKey, alg: "ES256" },
      redirectUri: "http://localhost:3000/auth/callback",
      postLogoutRedirectUri: "http://localhost:3000",
      scope: "openid profile email offline_access",
      discoveryDocument: {
        issuer: "https://playground-idp.example",
        authorization_endpoint: "https://playground-idp.example/authorize",
        token_endpoint: "https://playground-idp.example/token",
        pushed_authorization_request_endpoint: "https://playground-idp.example/par",
        jwks_uri: "https://playground-idp.example/jwks",
        end_session_endpoint: "https://playground-idp.example/logout",
      },
    },
    session: {
      // 32-char placeholder -- never do this for a real deployment, see README.
      password: "playground-only-not-a-real-secret",
    },
  },
  compatibilityDate: "2025-01-01",
});
