import type { H3Event } from "h3";
import type { OAuthHandlersConfig } from "@oauth-spa-kit/server";
import { useRuntimeConfig } from "#imports";

export function resolveHandlersConfig(event: H3Event): OAuthHandlersConfig {
  const config = useRuntimeConfig(event).oauthSpaKit;
  if (!config?.session?.password) {
    throw new Error("oauthSpaKit.session.password is not set -- set NUXT_OAUTH_SPA_KIT_SESSION_PASSWORD or runtimeConfig.oauthSpaKit.session.password.");
  }
  return config;
}
