import { addImports, addServerHandler, addPlugin, createResolver, defineNuxtModule } from "@nuxt/kit";
import { defu } from "defu";
import type { OAuthClientConfig } from "@oauth-spa-kit/core";
import type { SessionConfig } from "@oauth-spa-kit/server";

export interface ModuleOptions {
  oauth: OAuthClientConfig;
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
