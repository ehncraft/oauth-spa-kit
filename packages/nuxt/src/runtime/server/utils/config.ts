import type { H3Event } from "h3";
import { getRequestURL } from "h3";
import type { OAuthHandlersConfig, SessionStore } from "@oauth-spa-kit/server";
import { importClientAssertionPrivateKey } from "@oauth-spa-kit/core";
import { useRuntimeConfig, useStorage } from "#imports";

/**
 * Adapts a named Nitro storage mount (`nitro.storage[mountName]` in `nuxt.config.ts` -- Redis,
 * Cloudflare KV, fs, whatever driver that mount configures) to `@oauth-spa-kit/server`'s
 * `SessionStore` interface. `ttl` support is driver-specific (unstorage's Redis driver honors
 * it via `EX`; a plain fs/memory mount used in dev won't actually expire entries early -- the
 * cookie's own `Max-Age` still bounds how long a browser will keep presenting it either way).
 */
function storageBackedSessionStore(mountName: string): SessionStore {
  const storage = useStorage(mountName);
  return {
    async get(sessionId) {
      return (await storage.getItem<string>(sessionId)) ?? null;
    },
    async set(sessionId, sealedPayload, maxAgeSeconds) {
      await storage.setItem(sessionId, sealedPayload, { ttl: maxAgeSeconds });
    },
    async delete(sessionId) {
      await storage.removeItem(sessionId);
    },
  };
}

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
  const { storageMount, ...sessionRest } = config.session;

  return {
    ...config,
    session: {
      ...sessionRest,
      store: storageMount ? storageBackedSessionStore(storageMount) : undefined,
    },
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
