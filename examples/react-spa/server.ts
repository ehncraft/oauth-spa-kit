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

const config: OAuthHandlersConfig = {
  oauth: {
    authority: process.env.OAUTH_AUTHORITY!,
    clientId: process.env.OAUTH_CLIENT_ID!,
    redirectUri: `${process.env.APP_ORIGIN}/auth/callback`,
    postLogoutRedirectUri: process.env.APP_ORIGIN,
    scope: "openid profile email offline_access",
    dpop: true,
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
