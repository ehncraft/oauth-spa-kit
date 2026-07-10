# @oauth-spa-kit/server

BFF-pattern OAuth handlers: sealed `HttpOnly` cookie sessions plus
login/callback/session/logout route factories, built on Web-standard
`Request`/`Response` so they drop into Nitro, Next.js route handlers,
Cloudflare Workers, or plain Node (via a small adapter).

Part of [oauth-spa-kit](https://github.com/ehncraft/oauth-spa-kit) -- see the
root README for the full architecture and request flow (PAR, PKCE, DPoP,
`private_key_jwt`, no `client_secret`, FAPI 2.0 baseline). If you're on
Nuxt, use [`@oauth-spa-kit/nuxt`](https://www.npmjs.com/package/@oauth-spa-kit/nuxt)
instead, which wires these same handlers in as Nitro routes for you.

## Install

```bash
npm install @oauth-spa-kit/server
```

## Usage

```ts
import {
  createLoginHandler,
  createCallbackHandler,
  createSessionHandler,
  createLogoutHandler,
  getAuthorizationHeader,
  type OAuthHandlersConfig,
} from "@oauth-spa-kit/server";

const config: OAuthHandlersConfig = {
  oauth: {
    authority: "https://idp.example.com",
    clientId: "spa-kit-demo",
    clientAuthentication: {
      method: "private_key_jwt",
      privateKey, // a non-extractable CryptoKey, PS256 or ES256
    },
    redirectUri: "https://app.example.com/auth/callback",
    scope: "openid profile offline_access",
    // dpop and par both default to true (FAPI 2.0 baseline)
  },
  session: {
    password: process.env.OAUTH_SESSION_PASSWORD!, // >=32 chars
  },
};

// Each returns a plain (Request) => Promise<Response> -- mount at
// GET /auth/login, GET /auth/callback, GET /auth/session, POST /auth/logout.
export const login = createLoginHandler(config);
export const callback = createCallbackHandler(config);
export const session = createSessionHandler(config);
export const logout = createLogoutHandler(config);

// From any other API route that needs to call an upstream resource server:
const authHeader = await getAuthorizationHeader(request, config);
```

The SPA never sees an access or refresh token -- only `GET /auth/session`'s
`{ user }` response, backed by a sealed cookie the browser can't read or
exfiltrate via JS. See
[`@oauth-spa-kit/core`](https://www.npmjs.com/package/@oauth-spa-kit/core)
for the lower-level protocol primitives these handlers are built from, and
[`@oauth-spa-kit/react`](https://www.npmjs.com/package/@oauth-spa-kit/react)
for a client-side `useAuth()` hook that talks to these routes.

## License

MIT
