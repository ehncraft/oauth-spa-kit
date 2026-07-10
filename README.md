# oauth-spa-kit

Framework-agnostic OAuth 2.1 / OIDC for JS SPAs -- one core, thin adapters
for React, Vue/Nuxt, or anything else that can call `fetch`. Built to the
[FAPI 2.0 Security Profile](https://openid.net/specs/fapi-2_0-security-profile.html)
baseline (PAR, PKCE, DPoP, `private_key_jwt` -- no shared secrets) using
only FIPS 140-approved algorithms.

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
OAuth *token* refresh at all (only session-cookie CRUD).

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

## Why no client_secret

This kit supports exactly one client authentication method:
[`private_key_jwt`](https://www.rfc-editor.org/rfc/rfc7523) (RFC 7523). A
shared `client_secret` is never accepted, in either the core token-exchange
functions or the config types -- there's no flag to turn it on. Two
independent reasons converge on the same answer:

- **FAPI 2.0** requires either `private_key_jwt` or mTLS for confidential
  client authentication; shared secrets aren't in the baseline profile.
- **FIPS 140** compliance is about approved algorithms, not really about
  secrets vs. keys, but a `client_secret` is a long-lived bearer credential
  that has to be generated, stored, and rotated as a shared value -- an
  asymmetric keypair replaces that with a private key that never leaves
  this server and a public key registered once with the AS.

All signing in this kit (client assertions, DPoP proofs) uses **PS256
(RSA-PSS) or ES256 (ECDSA P-256) only** -- see the comment on `JwtAlgorithm`
in `packages/core/src/jwt.ts`. RS256 is deliberately excluded: FAPI 2.0
requires PS256 or ES256 for asymmetric signing (RS256's PKCS#1 v1.5 padding
is legacy), and both remaining algorithms are FIPS 140-approved (FIPS
186-4/186-5) given approved parameters (RSA >=2048-bit, P-256).

## Layout

```
packages/
  core/     Pure OAuth/OIDC primitives -- PKCE, discovery, JWT sign/verify,
            DPoP proofs, private_key_jwt assertions, PAR, token exchange --
            plus the browser-side session client. Zero DOM/Node-only APIs
            (only Web Crypto + fetch), so this same code runs in the
            browser AND inside the server package below.
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

1. `GET /auth/login[?returnTo=/foo]` -- generates PKCE verifier/challenge,
   `state`/`nonce`, and (unless `dpop: false`) a DPoP key pair whose JWK
   thumbprint is sent as `dpop_jkt` (RFC 9449 section 10), binding the
   authorization code itself to that key before any token exists. Unless
   `par: false`, these are **pushed** to the AS's PAR endpoint (RFC 9126)
   rather than placed on the `/authorize` query string, so none of it sits
   in browser history or the `Referer` header; the browser redirect then
   only carries `client_id` + the resulting single-use `request_uri`. All
   of this -- verifier, state, nonce, the DPoP key pair -- is stored in a
   **separate**, 5-minute, signed cookie (not server memory, so the BFF
   stays stateless across instances).
2. `GET /auth/callback?code=...&state=...` -- verifies `state`, exchanges
   `code` for tokens using the *same* DPoP key from step 1
   (`authorization_code` grant, PKCE-verified, `private_key_jwt`-
   authenticated), verifies the `id_token`'s signature against the AS's
   JWKS and its `iss`/`aud`/`nonce`/`exp` claims (OIDC Core section
   3.1.3.7) before trusting anything in it, seals `{ tokens, user,
   dpopKeyPair }` into the session cookie, redirects to `returnTo`.
3. `GET /auth/session` -- returns `{ user }` (never tokens). If the access
   token is within `refreshThresholdSeconds` (default 60s, same default
   `oidc-client-ts` uses) of expiry, refreshes server-side first via the
   `refresh_token` grant -- reusing the same DPoP key the tokens were bound
   to, since a DPoP-bound refresh token must be renewed with the key that
   obtained it -- and re-seals the cookie. If refresh fails (token revoked,
   rotated-and-reused, IdP down), returns 401 and clears the cookie -- no
   silently-stale "authenticated" state.
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
- **PAR by default** (RFC 9126, `par: true` unless explicitly disabled) --
  required by FAPI 2.0; keeps every authorization request parameter off
  the browser-visible URL.
- **`private_key_jwt` only, no `client_secret`** -- see "Why no
  client_secret" above.
- **DPoP by default** (RFC 9449, `dpop: true` unless explicitly disabled)
  -- sender-constrains tokens to a key pair generated server-side, bound to
  the authorization code via `dpop_jkt` at request time, reused for every
  subsequent refresh, and retried transparently against a
  `use_dpop_nonce` challenge (RFC 9449 section 8). Pairs with a
  resource-server-side verifier like this workspace's own
  `apisix/custom-plugins/apisix/plugins/dpop-verify.lua`.
- **Refresh token rotation expected**: `exchangeRefreshToken` carries the
  old refresh token forward only if the server omits a new one; if your
  IdP rotates and detects reuse of an old token, that's a signal of theft
  -- the session handler treats any refresh failure as "log the user out",
  not "retry with the stale token".
- **`id_token` signature verified against the AS's JWKS** before any claim
  in it is trusted (issuer, audience, nonce, expiry all checked too) --
  see `verifyIdToken` in `packages/server/src/handlers.ts`.
- **Cross-tab logout sync via `BroadcastChannel`**, not the
  `localStorage` key-and-storage-event trick.

## Status

Not yet published, but the full pipeline has actually been run, not just
eyeballed: `pnpm install`, `pnpm build`/`typecheck` across all 4 packages
(`nuxt` via its real build tool, `nuxt-module-build`), and `pnpm test` --
**78 passing tests** across `core` and `server` (PKCE against the RFC 7636
test vector, JWT sign/verify for both algorithms, DPoP proof structure +
nonce retry + key export/import round-trips, PAR, client assertions, and a
full login -> PAR -> callback -> JWKS-verified session -> refresh -> logout
integration suite against a mocked authorization server in
`packages/server/test/handlers.test.ts`).

`packages/nuxt/playground/` is a minimal Nuxt app (static discovery
document and an ephemeral key pair, so `nuxi dev`/`prepare` never need
network access by default) that exists for one reason: `nuxi prepare
playground` generates `playground/.nuxt/tsconfig*.json`, which the `nuxt`
package's own `tsconfig.json` references instead of compiling `src/`
directly -- the same pattern `nuxt-auth-utils` itself uses, since `#imports`
is a virtual module Nuxt only generates inside a real app. With that in
place `pnpm typecheck` now covers `nuxt/src/runtime/**` too, `#imports` and
all -- run `pnpm --filter=@oauth-spa-kit/nuxt run dev:prepare` once after
cloning (CI does this automatically before typechecking).

The same playground can also be pointed at a real local IdP instead of the
offline stub, to click through `useAuth().login()` and confirm it actually
lands on that server's login UI -- set `PLAYGROUND_OAUTH_AUTHORITY` (plus
`PLAYGROUND_OAUTH_CLIENT_ID` and `PLAYGROUND_OAUTH_PRIVATE_KEY_JWK` for a
key already registered on that client) before running `dev`; see the
comment at the top of `packages/nuxt/playground/nuxt.config.ts` for the
full variable list and an example invocation.

### Releasing

Versioning and publishing are automated with
[semantic-release](https://semantic-release.gitbook.io/), driven by
[Conventional Commits](https://www.conventionalcommits.org/) -- there's no
manual version bump or tag. `.github/workflows/release.yml` runs on every
push to `master` (install, build, typecheck, test, then `pnpm run
release`); semantic-release reads the commits since the last release,
decides whether a release is needed and what type (`fix:` -> patch,
`feat:` -> minor, a `BREAKING CHANGE:` footer -> major), and if so:

- Stamps that version into all 4 `packages/*/package.json` in lockstep
  (`scripts/set-versions.mjs`, driven by `release.config.js`'s
  `@semantic-release/exec` step) -- they always ship at the same version.
- Publishes all 4 to npm via `pnpm run publish:packages` (not
  `@semantic-release/npm`'s own publish step, which shells out to plain
  `npm publish` and wouldn't resolve pnpm's `workspace:*` protocol in the
  packages' internal deps).
- Updates `CHANGELOG.md`, commits `chore(release): x.y.z [skip ci]`, tags,
  and pushes back to `master`, then creates a GitHub Release.

Needs an `NPM_TOKEN` repo secret (an npm automation token with publish
rights on the `@oauth-spa-kit` scope) -- `GITHUB_TOKEN` is the default
Actions token, already scoped by the `permissions:` block in the workflow.

Commit messages are enforced locally via commitlint + husky
(`.husky/commit-msg`, `commitlint.config.js`) -- a non-conventional commit
message is rejected at commit time, before it can silently fail to trigger
the release it should.

Next step: a real deployment target for `examples/react-spa`'s server half
(currently written against any Web-standard-`Request` runtime, untested
against a specific one).
