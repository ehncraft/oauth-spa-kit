# @oauth-spa-kit/nuxt

Nuxt module wiring [`@oauth-spa-kit/server`](https://www.npmjs.com/package/@oauth-spa-kit/server)'s
handlers as Nitro server routes, plus a `useAuth()` composable over
[`@oauth-spa-kit/core`](https://www.npmjs.com/package/@oauth-spa-kit/core)'s
session client -- same `user`/`loggedIn`/`ready` shape as
[`nuxt-auth-utils`](https://github.com/atinux/nuxt-auth-utils)'
`useUserSession`.

Part of [oauth-spa-kit](https://github.com/ehncraft/oauth-spa-kit) -- see the
root README for the full architecture and request flow (PAR, PKCE, DPoP,
`private_key_jwt`, no `client_secret`, FAPI 2.0 baseline).

## Install

```bash
npm install @oauth-spa-kit/nuxt
```

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ["@oauth-spa-kit/nuxt"],
  oauthSpaKit: {
    oauth: {
      authority: "https://idp.example.com",
      clientId: "spa-kit-demo",
      clientAuthentication: {
        method: "private_key_jwt",
        privateKeyJwk, // a JWK (PS256 or ES256), e.g. JSON.parse(process.env.OAUTH_PRIVATE_KEY_JWK!) -- server-only runtime config, never baked into the client bundle
      },
      scope: "openid profile offline_access",
      // redirectUri defaults to `${requestOrigin}/auth/callback`, derived
      // per-request from the incoming Host header -- set it explicitly only
      // if the app is fronted by a hostname the request itself won't see.
      // dpop and par both default to true (FAPI 2.0 baseline)
    },
    session: {
      password: process.env.OAUTH_SESSION_PASSWORD!, // >=32 chars
    },
  },
});
```

The module registers `GET /auth/login`, `GET /auth/callback`,
`GET /auth/session`, and `POST /auth/logout` as Nitro routes automatically.

## Usage

```vue
<script setup>
const { ready, loggedIn, user, login, logout } = useAuth();
</script>

<template>
  <div v-if="ready">
    <button v-if="!loggedIn" @click="login('/dashboard')">Log in</button>
    <template v-else>
      <p>Signed in as {{ user?.name }}</p>
      <button @click="logout()">Log out</button>
    </template>
  </div>
</template>
```

The SPA never sees an access or refresh token -- `useAuth()` reads a
same-origin `/auth/session` response backed by a sealed `HttpOnly` cookie.

## License

MIT
