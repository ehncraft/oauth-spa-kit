import { computed, onScopeDispose, shallowRef } from "vue";
import { createSessionClient, type SessionClient, type SessionState } from "@oauth-spa-kit/core";
import { useNuxtApp } from "#imports";

// One session client per app instance -- cached on the nuxtApp instance
// itself (fresh per request on the server, one per app in the browser)
// rather than `useState`, since `SessionClient` carries methods
// (`login`/`logout`/`subscribe`) and `useState`'s value gets serialized
// into the SSR-to-client hydration payload, which fails on functions.
function getClient(): SessionClient {
  const nuxtApp = useNuxtApp() as { _oauthSpaKitClient?: SessionClient };
  if (!nuxtApp._oauthSpaKitClient) {
    nuxtApp._oauthSpaKitClient = createSessionClient();
  }
  return nuxtApp._oauthSpaKitClient;
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
