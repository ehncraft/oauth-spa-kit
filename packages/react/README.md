# @oauth-spa-kit/react

React bindings for [`@oauth-spa-kit/core`](https://www.npmjs.com/package/@oauth-spa-kit/core)'s
session client -- an `<AuthProvider>` + `useAuth()` hook, same shape as
[`nuxt-auth-utils`](https://github.com/atinux/nuxt-auth-utils)'
`useUserSession` composable.

Part of [oauth-spa-kit](https://github.com/ehncraft/oauth-spa-kit) -- see the
root README for the full architecture. Pair with
[`@oauth-spa-kit/server`](https://www.npmjs.com/package/@oauth-spa-kit/server)'s
route handlers mounted on the same origin under `/auth/*`.

## Install

```bash
npm install @oauth-spa-kit/react
```

## Usage

```tsx
import { AuthProvider, useAuth } from "@oauth-spa-kit/react";

function App() {
  return (
    <AuthProvider baseUrl="/auth">
      <Dashboard />
    </AuthProvider>
  );
}

function Dashboard() {
  const { ready, loggedIn, user, login, logout } = useAuth();

  if (!ready) return null;
  if (!loggedIn) return <button onClick={() => login("/dashboard")}>Log in</button>;

  return (
    <>
      <p>Signed in as {user?.name}</p>
      <button onClick={() => void logout()}>Log out</button>
    </>
  );
}
```

`<AuthProvider>` fetches `/auth/session` on mount and never holds an access
or refresh token in the browser -- `useAuth()` is a thin
`useSyncExternalStore` view over that same state, kept in sync across tabs
via `BroadcastChannel`.

## License

MIT
