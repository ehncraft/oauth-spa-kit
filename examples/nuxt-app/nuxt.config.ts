// Illustrative only -- not part of the workspace build/typecheck (no
// package.json here, and `defineNuxtConfig` is a Nuxt build-time global
// this standalone file has no way to resolve). See examples/react-spa/
// server.ts for how to generate/load the private key -- private_key_jwt is
// the only client authentication method this kit supports.
const privateKey = await crypto.subtle.importKey(
  "pkcs8",
  Uint8Array.from(atob(process.env.OAUTH_CLIENT_PRIVATE_KEY_PKCS8!), (c) => c.charCodeAt(0)),
  { name: "ECDSA", namedCurve: "P-256" },
  false,
  ["sign"],
);

export default defineNuxtConfig({
  modules: ["@oauth-spa-kit/nuxt"],
  oauthSpaKit: {
    oauth: {
      authority: process.env.OAUTH_AUTHORITY!,
      clientId: process.env.OAUTH_CLIENT_ID!,
      clientAuthentication: {
        method: "private_key_jwt",
        privateKey,
        keyId: process.env.OAUTH_CLIENT_KEY_ID,
        alg: "ES256",
      },
      scope: "openid profile email offline_access",
      // redirectUri / postLogoutRedirectUri default to the request's own
      // origin (Host header, X-Forwarded-Host-aware) -- set them explicitly
      // only if this app is fronted by a hostname the request won't reflect.
      // dpop and par both default to true (FAPI 2.0 baseline) -- omitted here deliberately.
    },
    session: {
      password: process.env.OAUTH_SESSION_PASSWORD!,
    },
  },
});
