// Illustrative only -- not part of the workspace build/typecheck (no
// package.json here), so it won't have `@oauth-spa-kit/*` or `@types/node`
// resolved by an editor opening this file standalone.
//
// Minimal standalone auth server for a Vite/CRA-style React SPA with no
// other backend -- e.g. deployable as a Cloudflare Worker, a Vercel Edge
// Function, or (via a tiny Node http adapter) a plain Node process. Run
// this on the same origin as the SPA (or behind the same reverse proxy) so
// the session cookie is same-site.
import {
  createLoginHandler,
  createCallbackHandler,
  createSessionHandler,
  createLogoutHandler,
  type OAuthHandlersConfig,
} from "@oauth-spa-kit/server";

// private_key_jwt is the only client authentication method this kit
// supports (no client_secret -- see the ClientAuthentication doc comment
// in @oauth-spa-kit/core for why). Generate a key pair once and register
// its public JWK with your authorization server; keep the private key out
// of source control (env var, secret manager, KMS -- whatever your
// deploy target supports for a PKCS8 DER blob).
//
//   openssl ecparam -genkey -name prime256v1 -noout -out key.pem
//   openssl pkcs8 -topk8 -nocrypt -in key.pem -outform DER | base64 > key.pkcs8.b64
async function loadClientPrivateKey(): Promise<CryptoKey> {
  const pkcs8Base64 = process.env.OAUTH_CLIENT_PRIVATE_KEY_PKCS8!;
  const der = Uint8Array.from(atob(pkcs8Base64), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

const config: OAuthHandlersConfig = {
  oauth: {
    authority: process.env.OAUTH_AUTHORITY!,
    clientId: process.env.OAUTH_CLIENT_ID!,
    clientAuthentication: {
      method: "private_key_jwt",
      privateKey: await loadClientPrivateKey(),
      keyId: process.env.OAUTH_CLIENT_KEY_ID, // must match a `kid` in the JWKS you registered with the AS
      alg: "ES256",
    },
    redirectUri: `${process.env.APP_ORIGIN}/auth/callback`,
    postLogoutRedirectUri: process.env.APP_ORIGIN,
    scope: "openid profile email offline_access",
    // dpop and par both default to true (FAPI 2.0 baseline) -- omitted here deliberately.
  },
  session: {
    password: process.env.OAUTH_SESSION_PASSWORD!, // openssl rand -base64 32
  },
  defaultReturnTo: "/",
};

const login = createLoginHandler(config);
const callback = createCallbackHandler(config);
const session = createSessionHandler(config);
const logout = createLogoutHandler(config);

// Web-standard fetch handler -- wire this into whichever runtime you deploy to.
export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/auth/login") return login(request);
    if (url.pathname === "/auth/callback") return callback(request);
    if (url.pathname === "/auth/session") return session(request);
    if (url.pathname === "/auth/logout" && request.method === "POST") return logout(request);
    return new Response("Not found", { status: 404 });
  },
};
