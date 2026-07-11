import { addImports, addServerHandler, addPlugin, createResolver, defineNuxtModule } from "@nuxt/kit";
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
  session: SessionConfig;
  refreshThresholdSeconds?: number;
}

// Nuxt's own RuntimeConfig has no knowledge of this module's shape by
// default -- augment it so both `nuxt.options.runtimeConfig.oauthSpaKit`
// here and `useRuntimeConfig(event).oauthSpaKit` server-side are typed
// instead of `unknown`.
declare module "@nuxt/schema" {
  interface RuntimeConfig {
    oauthSpaKit: ModuleOptions;
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

    addServerHandler({ route: "/auth/login", handler: resolver.resolve("./runtime/server/routes/auth/login.get") });
    addServerHandler({ route: "/auth/callback", handler: resolver.resolve("./runtime/server/routes/auth/callback.get") });
    addServerHandler({ route: "/auth/session", handler: resolver.resolve("./runtime/server/routes/auth/session.get") });
    addServerHandler({ route: "/auth/logout", method: "post", handler: resolver.resolve("./runtime/server/routes/auth/logout.post") });

    addImports({ name: "useAuth", from: resolver.resolve("./runtime/app/composables/useAuth") });
    addPlugin(resolver.resolve("./runtime/app/plugins/session.client"));
  },
});
