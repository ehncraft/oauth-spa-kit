import type { H3Event } from "h3";
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

  const { clientAuthentication, ...oauthRest } = config.oauth;
  if (!cachedPrivateKey) {
    cachedPrivateKey = importClientAssertionPrivateKey(clientAuthentication.privateKeyJwk, clientAuthentication.alg ?? "ES256");
  }

  return {
    ...config,
    oauth: {
      ...oauthRest,
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
