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
  /**
   * Interval (ms) for a background liveness check against `livenessPath`, on top of the
   * normal navigation-triggered `refresh()` calls. Off by default -- opt in only if you need
   * to react to a session dying (revoked access, deactivated account) *before* the user's next
   * navigation. Unlike `/auth/session` (which only inspects the local cookie/token expiry),
   * the liveness check makes a real round trip to the AS, so it also catches "token still
   * technically unexpired but the account was just deactivated or the session was revoked
   * elsewhere" -- not just token expiry, which is already handled reactively.
   */
  livenessCheckIntervalMs?: number;
  /** Same-origin path for the liveness check. Defaults to `/auth/liveness`. */
  livenessPath?: string;
  /**
   * Called once a liveness check confirms the session is actually dead (after two consecutive
   * failures, to ride out a single transient network blip rather than force-logging someone
   * out over it). `state.loggedIn` is already flipped to `false` before this fires -- use it
   * for anything beyond reactive state, e.g. redirecting straight to `login()`.
   */
  onSessionExpired?: () => void;
  /**
   * Inactivity window (ms) before an authenticated session is force-logged-out client-side,
   * regardless of whether the server-side session/token is still valid. Neither the liveness
   * poller above nor the navigation-triggered refresh() ever notice a merely idle tab -- both
   * only catch a session the server already killed -- so without this, a tab left open and
   * untouched with an otherwise-valid session stays logged in forever. Reset on `mousemove`,
   * `keydown`, `click`, `scroll`, and `touchstart`. Defaults to 15 minutes; pass `0` to disable.
   */
  idleTimeoutMs?: number;
  /** Called immediately before the idle-triggered logout redirect fires. */
  onIdleTimeout?: () => void;
}

export interface SessionClient {
  getState(): SessionState;
  subscribe(callback: (state: SessionState) => void): () => void;
  /** Re-fetch `/auth/session`. Call after mount and after `login`/`logout` round trips. */
  refresh(): Promise<void>;
  /** Full-page navigation to the login handler -- there is no silent/iframe path in BFF mode. */
  login(returnTo?: string): void;
  /**
   * Full-page navigation to the logout handler, same as `login`. RP-Initiated Logout
   * (OIDC section 5) redirects the browser to the IdP's `end_session_endpoint`, which is
   * a *different origin* from this app -- clearing/invalidating that session requires the
   * IdP's own session cookie to actually be sent there and its response cookie actually
   * stored, and browsers only do that for a real top-level navigation, not a `fetch()`
   * (even with `redirect: "follow"`, `credentials: "same-origin"` scopes cookie handling
   * to same-origin hops only, so the cross-origin hop to the IdP carries no cookie either
   * way). A fetch-based logout silently no-ops the IdP side: the local session clears, but
   * the IdP's SSO cookie survives, so the very next login silently re-authenticates through
   * it. Stays `Promise<void>` for call-site compatibility even though the navigation means
   * it never meaningfully resolves.
   */
  logout(): Promise<void>;
}

const initialState: SessionState = { ready: false, loggedIn: false, user: null };

/** Consecutive liveness-check failures required before treating a session as actually dead. */
const LIVENESS_FAILURE_THRESHOLD = 2;

const DEFAULT_IDLE_TIMEOUT_MS = 15 * 60_000;
const IDLE_ACTIVITY_EVENTS = ["mousemove", "keydown", "click", "scroll", "touchstart"] as const;

export function createSessionClient(options: SessionClientOptions = {}): SessionClient {
  const baseUrl = options.baseUrl ?? "";
  const fetchImpl = options.fetchImpl ?? fetch;
  const livenessPath = options.livenessPath ?? "/auth/liveness";
  const channel = typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel(options.channelName ?? "oauth-spa-kit")
    : null;

  let state: SessionState = initialState;
  const listeners = new Set<(state: SessionState) => void>();

  const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  const idleTrackingEnabled = typeof window !== "undefined" && idleTimeoutMs > 0;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  // Restarted on every activity event and on every state change (so a fresh login starts the
  // window immediately rather than waiting for the first mouse move) -- see `idleTimeoutMs` above.
  function resetIdleTimer() {
    if (!idleTrackingEnabled) return;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = state.loggedIn
      ? setTimeout(() => {
          options.onIdleTimeout?.();
          void logout();
        }, idleTimeoutMs)
      : undefined;
  }

  function setState(next: SessionState) {
    state = next;
    resetIdleTimer();
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
      const body = await response.json() as { user: SessionState["user"]; device?: string };
      setState({ ready: true, loggedIn: Boolean(body.user), user: body.user ?? null, device: body.device });
    } catch {
      setState({ ready: true, loggedIn: false, user: null });
    }
  }

  channel?.addEventListener("message", (event) => {
    if (event.data === "session-changed") void refresh();
  });

  if (typeof window !== "undefined" && options.livenessCheckIntervalMs) {
    let consecutiveFailures = 0;
    setInterval(() => {
      void (async () => {
        // Nothing to check liveness of yet -- the navigation-triggered refresh() is what
        // notices a fresh sign-in and flips this back on.
        if (!state.loggedIn) return;

        let alive: boolean;
        try {
          const response = await fetchImpl(`${baseUrl}${livenessPath}`, {
            headers: { accept: "application/json" },
            credentials: "same-origin",
          });
          alive = response.ok;
        } catch {
          alive = false;
        }

        if (alive) {
          consecutiveFailures = 0;
          return;
        }

        consecutiveFailures += 1;
        if (consecutiveFailures < LIVENESS_FAILURE_THRESHOLD) return;

        consecutiveFailures = 0;
        setState({ ready: true, loggedIn: false, user: null });
        channel?.postMessage("session-changed");
        options.onSessionExpired?.();
      })();
    }, options.livenessCheckIntervalMs);
  }

  function login(returnTo?: string): void {
    const url = new URL(`${baseUrl}/auth/login`, window.location.origin);
    if (returnTo) url.searchParams.set("returnTo", returnTo);
    window.location.assign(url.toString());
  }

  async function logout(): Promise<void> {
    const url = new URL(`${baseUrl}/auth/logout`, window.location.origin);
    window.location.assign(url.toString());
  }

  if (idleTrackingEnabled) {
    for (const event of IDLE_ACTIVITY_EVENTS) {
      window.addEventListener(event, resetIdleTimer, { passive: true });
    }
  }

  return {
    getState: () => state,
    subscribe(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    refresh,
    login,
    logout,
  };
}
