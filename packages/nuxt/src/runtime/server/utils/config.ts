import type { H3Event } from "h3";
import { getRequestURL } from "h3";
import type { OAuthHandlersConfig } from "@oauth-spa-kit/server";
import { importClientAssertionPrivateKey } from "@oauth-spa-kit/core";
import { useRuntimeConfig } from "#imports";

// The imported CryptoKey is derived from fixed server config, not per-user
// state, so it's cached process-wide -- each request importing the same
// JWK again would be wasteful.
let cachedPrivateKey: Promise<CryptoKey> | undefined;

export async function resolveHandlersConfig(event: H3Event): Promise<OAuthHandlersConfig> {
  const config = useRuntimeConfig(event).oauthSpaKit;
  if (!config?.session?.password) {
    throw new Error("oauthSpaKit.session.password is not set -- set NUXT_OAUTH_SPA_KIT_SESSION_PASSWORD or runtimeConfig.oauthSpaKit.session.password.");
  }

  const { clientAuthentication, redirectUri, postLogoutRedirectUri, ...oauthRest } = config.oauth;
  if (!cachedPrivateKey) {
    cachedPrivateKey = importClientAssertionPrivateKey(clientAuthentication.privateKeyJwk, clientAuthentication.alg ?? "ES256");
  }

  // Neither URI is baked into the running server's config by default: a BFF
  // app is always reached at exactly the origin it's registered under with
  // the AS, so that origin -- not a separately-configured APP_ORIGIN -- is
  // the right source of truth. Deriving it per-request (from Host,
  // X-Forwarded-Host-aware) means the same build works behind any
  // registered hostname without redeploying per environment. Explicit
  // config still wins, for deployments that front the app with a hostname
  // the request itself doesn't see.
  const origin = getRequestURL(event, { xForwardedHost: true }).origin;

  return {
    ...config,
    oauth: {
      ...oauthRest,
      redirectUri: redirectUri ?? `${origin}/auth/callback`,
      postLogoutRedirectUri: postLogoutRedirectUri ?? origin,
      clientAuthentication: {
        method: "private_key_jwt",
        privateKey: await cachedPrivateKey,
        keyId: clientAuthentication.keyId,
        alg: clientAuthentication.alg,
        assertionLifetimeSeconds: clientAuthentication.assertionLifetimeSeconds,
      },
    },
  };
}
