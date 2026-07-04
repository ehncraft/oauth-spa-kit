# oauth-spa-kit

Framework-agnostic OAuth 2.1 / OIDC for JS SPAs -- one core, thin adapters
for React, Vue/Nuxt, or anything else that can call `fetch`.

## Why this shape

Two existing libraries got studied for this design, and each contributed a
different half:

- **[`oidc-client-ts`](https://github.com/authts/oidc-client-ts)** -- the
  reference for the *protocol* pieces: PKCE, OIDC discovery, expiry-aware
  token modeling, refresh-token-first renewal, structured events. Its
  `SilentRenewService`/`AccessTokenEvents` pair (expiry timers driving
  automatic `signinSilent()`) is the right idea for expiry handling.
- **[`nuxt-auth-utils`](https://github.com/atinux/nuxt-auth-utils)** -- the
  reference for the *session ergonomics*: a sealed HttpOnly cookie holding
  server-side state, and a dead-simple `useUserSession()`-style client
  (`user`, `loggedIn`, `ready`, `fetch`/`login`/`logout`) that never touches
  a token directly.

Neither is reused wholesale: `oidc-client-ts` is browser-only and assumes
tokens live in the SPA; `nuxt-auth-utils` is Nuxt/Nitro-only and has no
OAuth *token* refresh at all (only session-cookie CRUD -- see the
conversation this repo came out of for specifics).

## Why BFF-only, not a pluggable token store

Current guidance (OWASP, Auth0, the OAuth 2.1 draft's public-client
guidance) has converged on: **don't put access or refresh tokens in
JS-reachable storage at all if you can avoid it.** `localStorage` is
readable by any injected script; even in-memory tokens are readable by an
XSS payload for as long as the tab lives. A Backend-for-Frontend removes
the token from the browser's trust boundary entirely -- the SPA only ever
holds a `HttpOnly; Secure; SameSite=Lax` session cookie it cannot read or
exfiltrate via JS, and calls same-origin endpoints for everything.

The trade-off is explicit: **this requires a server component**, even for
an otherwise-static React SPA. That's accepted here rather than hedged
with a pluggable in-memory mode, because a dual-mode design tends to make
the insecure option one config flag away, and the whole point is to make
the secure default the only path.

## Layout

```
packages/
  core/     Pure OAuth/OIDC primitives -- PKCE, discovery, token exchange,
            DPoP proof generation, plus the browser-side session client.
            Zero DOM/Node-only APIs (only Web Crypto + fetch), so this same
            code runs in the browser AND inside the server package below.
  server/   BFF: sealed-cookie session + createLoginHandler /
            createCallbackHandler / createSessionHandler /
            createLogoutHandler / getAuthorizationHeader. Handlers are
            plain `(Request) => Promise<Response>` -- deploy on Nitro,
            Next.js route handlers, Cloudflare Workers, or Node via a small
            adapter.
  react/    <AuthProvider> + useAuth() (useSyncExternalStore-based).
  nuxt/     Nuxt module: wires server/'s handlers as Nitro routes, exposes
            a useAuth() composable with the same shape as react/'s.
examples/
  react-spa/   Wiring sketch for a Vite React app + a standalone Node/edge
               server hosting the auth routes.
  nuxt-app/    Wiring sketch using the Nuxt module.
```

A plain Vue app (no Nuxt) can use `@oauth-spa-kit/core`'s
`createSessionClient()` directly the same way `react/`'s `useAuth` does --
there's no Vue-specific package because there's nothing left to adapt once
you're not inside Nitro.

## Request flow

1. `GET /auth/login[?returnTo=/foo]` -- generates PKCE verifier/challenge +
   `state`/`nonce`, stores them in a **separate**, 5-minute, signed cookie
   (not server memory -- keeps the BFF stateless across instances),
   redirects to the IdP's `authorization_endpoint`.
2. `GET /auth/callback?code=...&state=...` -- verifies `state`, exchanges
   `code` for tokens (`authorization_code` grant, PKCE-verified), seals
   `{ tokens, user }` into the session cookie, redirects to `returnTo`.
3. `GET /auth/session` -- returns `{ user }` (never tokens). If the access
   token is within `refreshThresholdSeconds` (default 60s, same default
   `oidc-client-ts` uses) of expiry, refreshes server-side first via the
   `refresh_token` grant and re-seals the cookie. If refresh fails (token
   revoked, rotated-and-reused, IdP down), returns 401 and clears the
   cookie -- no silently-stale "authenticated" state.
4. `POST /auth/logout` -- clears the cookie, optionally redirects through
   the IdP's `end_session_endpoint` (RP-Initiated Logout) if configured.
5. App API routes that need to call an upstream resource server call
   `getAuthorizationHeader(request, config)` to get a guaranteed-fresh
   `Authorization` header, refreshing under the hood exactly like step 3.

No hidden iframe / `prompt=none` silent-renew path exists here, unlike
`oidc-client-ts`'s iframe fallback -- third-party cookie restrictions
(Safari ITP, Chrome's phase-out) make that increasingly unreliable, and in
the BFF pattern there's no need for it: renewal is a same-origin
`refresh_token` exchange the browser never has to participate in.

## Recommended practices this bakes in

- **PKCE always**, no exceptions -- OAuth 2.1 makes it mandatory for every
  authorization-code client, not just public ones.
- **Refresh token rotation expected**: `exchangeRefreshToken` carries the
  old refresh token forward only if the server omits a new one; if your
  IdP rotates and detects reuse of an old token, that's a signal of theft
  -- the session handler treats any refresh failure as "log the user out",
  not "retry with the stale token".
- **DPoP (RFC 9449) as an opt-in** (`oauth.dpop: true`) -- sender-constrains
  tokens to a non-extractable key pair, so a leaked token is useless
  without the private key. Pairs with a resource-server-side verifier like
  this workspace's own
  `apisix/custom-plugins/apisix/plugins/dpop-verify.lua`.
- **No id_token trust without verification** -- the callback handler
  decodes `id_token` claims for convenience but the code comments flag
  that production needs signature verification against `jwks_uri` before
  trusting them; that's intentionally left as a follow-up rather than
  faked with a fake sense of security.
- **Cross-tab logout sync via `BroadcastChannel`**, not the
  `localStorage` key-and-storage-event trick.

## Status

Design sketch, not a published package -- but `pnpm install` plus
`build`/`typecheck` per package have actually been run against it, not just
eyeballed:

- `core`, `server`, `react`, and `nuxt`'s own files (module.ts, server
  routes, composable) all typecheck clean.
- `nuxt`'s runtime files (`src/runtime/**`) show `Cannot find module
  '#imports'` under a plain `tsc --noEmit` -- this is expected, not a bug:
  `#imports` is a virtual module Nuxt only generates by running `nuxi
  prepare` inside a real Nuxt app. Checked this against the actual
  `nuxt-auth-utils` source: its own `tsconfig.json` excludes
  `src/runtime`/`playground` from direct compilation for the same reason,
  resolving types only through a `playground/` app's generated
  `.nuxt/tsconfig.*.json`. Wiring up an equivalent `playground/` here would
  close this gap the same way upstream does.

Next steps before this is usable: add `jose`-based `id_token` signature
verification (currently decoded but not verified -- flagged inline in
`handlers.ts`), a Vitest suite per package (token exchange against a mock
IdP, cookie seal/unseal round trips), the `nuxt` package's `playground/`
app mentioned above, and pick a real deployment target for
`examples/react-spa`'s server half (the sketch assumes any Web-standard-
`Request` runtime).
