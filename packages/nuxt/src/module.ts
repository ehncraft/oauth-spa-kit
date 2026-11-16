import { addImports, addServerHandler, addServerImports, addPlugin, createResolver, defineNuxtModule } from "@nuxt/kit";
import { defu } from "defu";
import type { OAuthClientConfig, JwtAlgorithm } from "@oauth-spa-kit/core";
import type { SessionConfig } from "@oauth-spa-kit/server";

/**
 * Same shape as `@oauth-spa-kit/core`'s `ClientAuthentication`, except the
 * private key is a plain JWK instead of a live `CryptoKey`. This config
 * goes through Nuxt's `runtimeConfig`, which only round-trips
 * JSON-serializable values -- a `CryptoKey` doesn't survive Nitro's build
 * pipeline intact. The server routes import it into a real `CryptoKey` on
 * first use instead; see `runtime/server/utils/config.ts`.
 */
export interface ModuleClientAuthentication {
  method: "private_key_jwt";
  privateKeyJwk: JsonWebKey;
  keyId?: string;
  alg?: JwtAlgorithm;
  assertionLifetimeSeconds?: number;
}

export interface ModuleOptions {
  oauth: Omit<OAuthClientConfig, "clientAuthentication" | "redirectUri"> & {
    clientAuthentication: ModuleClientAuthentication;
    /**
     * Defaults to `${requestOrigin}/auth/callback`, derived per-request from
     * the incoming Host header (X-Forwarded-Host-aware) -- a BFF app is only
     * ever reached at the origin it's registered under with the AS, so that
     * origin is the right default. Set explicitly only if the app is fronted
     * by a hostname the request itself won't reflect.
     */
    redirectUri?: string;
  };
  session: Omit<SessionConfig, "store"> & {
    /**
     * Mounts the session store on a named Nitro storage layer (`useStorage(storageMount)`)
     * instead of `@oauth-spa-kit/server`'s raw `SessionConfig.store` object -- that field is a
     * live object with `get`/`set`/`delete` *functions*, and Nuxt's `runtimeConfig` only
     * round-trips JSON-serializable values through Nitro's build; a function silently doesn't
     * survive that trip. A storage *mount name* is just a string, so it does. Configure the
     * actual backing driver (Redis, Cloudflare KV, fs, ...) the normal Nitro way, via
     * `nitro.storage[storageMount]` in `nuxt.config.ts` -- see the README. Omit to keep the
     * default fully-self-contained cookie (no store at all).
     */
    storageMount?: string;
  };
  refreshThresholdSeconds?: number;
  /**
   * Logs the callback handler's raw failure cause via `console.error` before
   * it's collapsed to a short error code in the `login_error` redirect param
   * -- on by default in every environment (a failed login is a production
   * signal, not just dev noise). Set to `false` to opt out.
   */
  logCallbackErrors?: boolean;
  authzen?: {
    pdpUrl?: string;
    subjectEndpoint?: string;
    subjectIdField?: string;
    subjectType?: string;
  };
  /** Browser-side session-client behavior. Unlike `oauth`/`session`, this reaches the client bundle -- keep it free of secrets. */
  client?: {
    /**
     * Interval (ms) for a background `/auth/liveness` poll, on top of the normal
     * navigation-triggered session check. Off by default. When a poll confirms the session
     * is actually dead, `useAuth()` redirects straight to `login()` -- see
     * `createSessionClient`'s `onSessionExpired` in `@oauth-spa-kit/core` for why this needs
     * a real round trip to the AS rather than just checking local token expiry.
     */
    livenessCheckIntervalMs?: number;
    /**
     * Inactivity window (ms) before an authenticated session is force-logged-out client-side,
     * regardless of whether the server-side session/token is still valid -- see
     * `createSessionClient`'s `idleTimeoutMs` in `@oauth-spa-kit/core`. Defaults to 15 minutes;
     * set to `0` to disable.
     */
    idleTimeoutMs?: number;
  };
}

// Nuxt's own RuntimeConfig has no knowledge of this module's shape by
// default -- augment it so both `nuxt.options.runtimeConfig.oauthSpaKit`
// here and `useRuntimeConfig(event).oauthSpaKit` server-side are typed
// instead of `unknown`.
declare module "@nuxt/schema" {
  interface RuntimeConfig {
    oauthSpaKit: ModuleOptions;
  }
  interface PublicRuntimeConfig {
    oauthSpaKit: { livenessCheckIntervalMs?: number; idleTimeoutMs?: number };
  }
}

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: "@oauth-spa-kit/nuxt",
    configKey: "oauthSpaKit",
  },
  setup(options, nuxt) {
    const resolver = createResolver(import.meta.url);

    // Runtime config, not build-time config: the client secret (confidential
    // BFF flows only -- never for a public/implicit client) and session
    // password must come from the environment, never get baked into the
    // client bundle.
    nuxt.options.runtimeConfig.oauthSpaKit = defu(
      nuxt.options.runtimeConfig.oauthSpaKit,
      options,
    );
    nuxt.options.runtimeConfig.public.oauthSpaKit = defu(
      nuxt.options.runtimeConfig.public.oauthSpaKit,
      {
        livenessCheckIntervalMs: options.client?.livenessCheckIntervalMs,
        idleTimeoutMs: options.client?.idleTimeoutMs,
      },
    ) as { livenessCheckIntervalMs?: number; idleTimeoutMs?: number };

    addServerHandler({ route: "/auth/login", handler: resolver.resolve("./runtime/server/routes/auth/login.get") });
    addServerHandler({ route: "/auth/callback", handler: resolver.resolve("./runtime/server/routes/auth/callback.get") });
    addServerHandler({ route: "/auth/session", handler: resolver.resolve("./runtime/server/routes/auth/session.get") });
    addServerHandler({ route: "/auth/logout", handler: resolver.resolve("./runtime/server/routes/auth/logout.get") });
    addServerHandler({ route: "/auth/liveness", handler: resolver.resolve("./runtime/server/routes/auth/liveness.get") });
    addServerHandler({ route: "/auth/authz/evaluate", handler: resolver.resolve("./runtime/server/routes/auth/authz/evaluate.post") });
    addServerHandler({ route: "/auth/authz/evaluate-batch", handler: resolver.resolve("./runtime/server/routes/auth/authz/evaluate-batch.post") });

    addImports({ name: "useAuth", from: resolver.resolve("./runtime/app/composables/useAuth") });
    addImports({ name: "useCan", from: resolver.resolve("./runtime/app/composables/useCan") });
    addPlugin(resolver.resolve("./runtime/app/plugins/session.client"));

    // resolveHandlersConfig is what every /auth/* route above actually uses to turn the raw
    // runtimeConfig placeholder into a real OAuthHandlersConfig (redirectUri derived from the
    // request origin, privateKeyJwk imported to a CryptoKey, session.storageMount adapted into
    // a real SessionStore) -- auto-imported here (Nitro server-only, matching useAuth's
    // client-only auto-import above) so a consumer's *own* custom authenticated server routes
    // (a userinfo proxy, a resource-API call helper, etc.) can call the exact same resolver
    // instead of maintaining a hand-rolled duplicate that WILL drift the next time this
    // function's internals change -- confirmed the hard way, see
    // https://github.com/ehncraft/oauth-spa-kit/issues/28.
    addServerImports([
      { name: "resolveHandlersConfig", from: resolver.resolve("./runtime/server/utils/config") },
      { name: "resolveAuthzenConfig", from: resolver.resolve("./runtime/server/utils/config") },
    ]);
  },
});
