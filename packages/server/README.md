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
  createLivenessHandler,
  getAuthorizationHeader,
  getUserInfo,
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
// GET /auth/login, GET /auth/callback, GET /auth/session, POST /auth/logout,
// GET /auth/liveness (optional -- see below).
export const login = createLoginHandler(config);
export const callback = createCallbackHandler(config);
export const session = createSessionHandler(config);
export const logout = createLogoutHandler(config);
export const liveness = createLivenessHandler(config);

// From any other API route that needs to call an upstream resource server:
const authHeader = await getAuthorizationHeader(request, config);

// Or, for the AS's own userinfo_endpoint specifically (DPoP proof, nonce
// retry, and token refresh all handled for you):
const info = await getUserInfo(request, config);
if (info) console.log(info.claims); // raw claims, shape depends on your granted scopes
```

The SPA never sees an access or refresh token -- only `GET /auth/session`'s
`{ user, device }` response, backed by a sealed cookie the browser can't
read or exfiltrate via JS. `device` is a best-effort label ("Chrome on
macOS") parsed from the callback request's `User-Agent` at sign-in --
useful for "you're signed in on X" UI, not a fingerprinting mechanism.

`createLivenessHandler` mounts a lightweight `GET /auth/liveness` that
returns `{ alive: boolean }`, backed by `getUserInfo` -- meant to be polled
on an interval from `@oauth-spa-kit/core`'s `createSessionClient`
(`livenessCheckIntervalMs`) so a session revoked or an account deactivated
server-side ends the SPA's session promptly, not just on the next
navigation. See
[`@oauth-spa-kit/core`](https://www.npmjs.com/package/@oauth-spa-kit/core)
for the lower-level protocol primitives these handlers are built from, and
[`@oauth-spa-kit/react`](https://www.npmjs.com/package/@oauth-spa-kit/react)
for a client-side `useAuth()` hook that talks to these routes.

## Server-side session store (optional)

By default the session cookie is fully self-contained -- access/id/refresh tokens, the DPoP key
pair, and user claims are all sealed (AES-256-GCM) directly into the cookie value. That's zero
infrastructure to run, but it does mean the cookie grows with however much token/claims data
accumulates, and browsers/proxies cap cookie size (commonly ~4KB).

Pass a `store` to keep the cookie small regardless: the cookie then carries only a random opaque
id, and the actual session data lives wherever you point `store` -- Redis, Cloudflare KV,
[unstorage](https://unstorage.unjs.io/), anything. The interface is deliberately three methods,
no framework assumptions:

```ts
import type { SessionStore } from "@oauth-spa-kit/server";

const store: SessionStore = {
  async get(sessionId) {
    return redis.get(`session:${sessionId}`);
  },
  async set(sessionId, sealedPayload, maxAgeSeconds) {
    await redis.set(`session:${sessionId}`, sealedPayload, "EX", maxAgeSeconds);
  },
  async delete(sessionId) {
    await redis.del(`session:${sessionId}`);
  },
};

const config: OAuthHandlersConfig = {
  oauth: { /* ... */ },
  session: {
    password: process.env.OAUTH_SESSION_PASSWORD!,
    store, // omit entirely to keep the default fully-in-cookie behavior
  },
};
```

The value handed to `store.set` is still sealed the same way the cookie itself would be -- your
store never sees plaintext tokens even if it's logged or inspected. `createLogoutHandler` and
`createLivenessHandler`'s rejected-session path both call the new `deleteStoredSession` for you,
so a logout (or a session AuthZEN/the AS itself has revoked) invalidates the store entry
immediately rather than only once your store's own TTL catches up. If you're writing a custom
handler instead of using the provided ones, call it yourself alongside `clearSessionHeader`:

```ts
import { clearSessionHeader, deleteStoredSession } from "@oauth-spa-kit/server";

await deleteStoredSession(request, config.session); // no-op if no store is configured
headers.append("Set-Cookie", clearSessionHeader(config.session));
```

## AuthZEN (externalized authorization)

Once a request is authenticated, [`evaluateAccess`](https://openid.net/specs/authorization-api-1_0-01.html)
and friends ask a [OpenID AuthZEN](https://openid.net/specs/authorization-api-1_0-01.html)-conformant
Policy Decision Point (OpenFGA, Topaz, Cerbos, Aserto, ...) whether the
session's subject may perform an action -- reusing the *same* session access
token `getAuthorizationHeader` would hand to any other upstream resource
server, so the PDP is treated like any other resource server this BFF calls
on the user's behalf, not a separately-credentialed service.

```ts
import { evaluateAccess, type AuthzenClientConfig } from "@oauth-spa-kit/server";

const authzen: AuthzenClientConfig = { pdpUrl: "https://pdp.example.com" };

// In an API route, after you already have `request` and `config` (above):
const access = await evaluateAccess(request, config, authzen, {
  subject: { type: "user", id: user.sub },
  resource: { type: "document", id: params.docId },
  action: { name: "can_read" },
});
if (access === null) return new Response("Unauthorized", { status: 401 }); // no session
if (!access.result.decision) return new Response("Forbidden", { status: 403 });
```

Every AuthZEN call returns `null` when there's no session to authorize with
(the same signal `getAuthorizationHeader` uses), and an `{ result, setCookie? }`
otherwise -- forward `setCookie` on your response if the underlying access
token needed a refresh. Also exported: `evaluateAccessBatch` (`POST
/access/v1/evaluations`, several checks in one PDP round trip) and
`searchResources` / `searchSubjects` / `searchActions` (the AuthZEN search
APIs -- e.g. "which documents can this user read").

## License

MIT
