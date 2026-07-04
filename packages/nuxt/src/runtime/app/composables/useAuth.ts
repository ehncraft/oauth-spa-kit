import { computed, onScopeDispose, shallowRef } from "vue";
import { createSessionClient, type SessionState } from "@oauth-spa-kit/core";
import { useState } from "#imports";

// One session client per app instance (SSR-safe via useState), mirroring
// nuxt-auth-utils' `useUserSession` composable shape (`user`, `loggedIn`,
// `ready`, plus `login`/`logout`).
function getClient() {
  const client = useState("oauth-spa-kit-client", () => createSessionClient());
  return client.value;
}

export function useAuth() {
  const client = getClient();
  const state = shallowRef<SessionState>(client.getState());
  const unsubscribe = client.subscribe((next) => { state.value = next; });
  onScopeDispose(unsubscribe);

  return {
    ready: computed(() => state.value.ready),
    loggedIn: computed(() => state.value.loggedIn),
    user: computed(() => state.value.user),
    refresh: client.refresh,
    login: client.login,
    logout: client.logout,
  };
}
