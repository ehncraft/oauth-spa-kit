import type { SessionState } from "./types.js";

/**
 * Browser-side session client for the BFF pattern: the SPA never sees an
 * access or refresh token, only a same-origin `/auth/session` JSON endpoint
 * backed by the server package's sealed HttpOnly cookie. This is
 * deliberately as thin as nuxt-auth-utils' `useUserSession` composable --
 * that simplicity is worth keeping -- but framework-agnostic so React/Vue/
 * vanilla adapters can all wrap the same object instead of reimplementing
 * fetch/cache/sync logic three times.
 *
 * Cross-tab sync uses BroadcastChannel instead of nuxt-auth-utils' storage-
 * event trick: it's purpose-built for this (no localStorage key squatting)
 * and is now supported in every evergreen browser.
 */

export interface SessionClientOptions {
  /** Same-origin prefix the server package's handlers are mounted under. */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  channelName?: string;
}

export interface SessionClient {
  getState(): SessionState;
  subscribe(callback: (state: SessionState) => void): () => void;
  /** Re-fetch `/auth/session`. Call after mount and after `login`/`logout` round trips. */
  refresh(): Promise<void>;
  /** Full-page navigation to the login handler -- there is no silent/iframe path in BFF mode. */
  login(returnTo?: string): void;
  logout(): Promise<void>;
}

const initialState: SessionState = { ready: false, loggedIn: false, user: null };

export function createSessionClient(options: SessionClientOptions = {}): SessionClient {
  const baseUrl = options.baseUrl ?? "";
  const fetchImpl = options.fetchImpl ?? fetch;
  const channel = typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel(options.channelName ?? "oauth-spa-kit")
    : null;

  let state: SessionState = initialState;
  const listeners = new Set<(state: SessionState) => void>();

  function setState(next: SessionState) {
    state = next;
    for (const listener of listeners) listener(state);
  }

  async function refresh(): Promise<void> {
    try {
      const response = await fetchImpl(`${baseUrl}/auth/session`, {
        headers: { accept: "application/json" },
        credentials: "same-origin",
      });
      if (response.status === 401) {
        setState({ ready: true, loggedIn: false, user: null });
        return;
      }
      if (!response.ok) throw new Error(`/auth/session returned ${response.status}`);
      const body = await response.json() as { user: SessionState["user"] };
      setState({ ready: true, loggedIn: Boolean(body.user), user: body.user ?? null });
    } catch {
      setState({ ready: true, loggedIn: false, user: null });
    }
  }

  channel?.addEventListener("message", (event) => {
    if (event.data === "session-changed") void refresh();
  });

  return {
    getState: () => state,
    subscribe(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    refresh,
    login(returnTo) {
      const url = new URL(`${baseUrl}/auth/login`, window.location.origin);
      if (returnTo) url.searchParams.set("returnTo", returnTo);
      window.location.assign(url.toString());
    },
    async logout() {
      await fetchImpl(`${baseUrl}/auth/logout`, { method: "POST", credentials: "same-origin" });
      setState({ ready: true, loggedIn: false, user: null });
      channel?.postMessage("session-changed");
    },
  };
}
