# @oauth-spa-kit/core

Framework- and runtime-agnostic OAuth 2.1 / OIDC primitives -- PKCE, discovery,
DPoP proofs, `private_key_jwt` client assertions, PAR, token exchange -- plus
a `fetch`-based session client. Only Web Crypto + `fetch`, no DOM or
Node-only APIs, so the same code runs in the browser and inside
[`@oauth-spa-kit/server`](https://www.npmjs.com/package/@oauth-spa-kit/server).

Part of [oauth-spa-kit](https://github.com/ehncraft/oauth-spa-kit) -- see the
root README for the full architecture (BFF pattern, no `client_secret`, FAPI
2.0 baseline).

## Install

```bash
npm install @oauth-spa-kit/core
```

## Usage

Most apps won't call this package directly -- pull in
[`@oauth-spa-kit/server`](https://www.npmjs.com/package/@oauth-spa-kit/server)
for the BFF route handlers, or
[`@oauth-spa-kit/react`](https://www.npmjs.com/package/@oauth-spa-kit/react) /
[`@oauth-spa-kit/nuxt`](https://www.npmjs.com/package/@oauth-spa-kit/nuxt)
for framework bindings, which both build on this package's
`createSessionClient()`:

```ts
import { createSessionClient } from "@oauth-spa-kit/core";

const client = createSessionClient({
  baseUrl: "/auth",
  // Optional: poll GET /auth/liveness in the background so a session
  // revoked or an account deactivated server-side ends this tab's session
  // promptly, not just on the next navigation. Off by default.
  livenessCheckIntervalMs: 60_000,
  onSessionExpired: () => client.login(),
});

client.subscribe((state) => {
  // state.ready, state.loggedIn, state.user, state.device
});

await client.refresh(); // GET /auth/session
client.login("/dashboard"); // full-page redirect, no silent/iframe path
await client.logout();
```

`state.device` is a best-effort label ("Chrome on macOS") the server
package parses from the `User-Agent` at sign-in via `parseUserAgent()`,
also exported from this package -- useful for "you're signed in on X" UI.

The lower-level protocol primitives (`createPkceParams`,
`discoverOidcConfiguration`, `pushAuthorizationRequest`,
`exchangeAuthorizationCode`, `exchangeRefreshToken`, `generateDpopKeyPair`,
`verifyJwt`, etc.) are what `@oauth-spa-kit/server`'s handlers are built
from -- see its README if you're wiring a BFF for a runtime this kit doesn't
already have an adapter for.

## License

MIT
