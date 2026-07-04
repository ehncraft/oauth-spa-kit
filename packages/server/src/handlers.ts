import {
  createPkceParams,
  discoverOidcConfiguration,
  exchangeAuthorizationCode,
  exchangeRefreshToken,
  generateDpopKeyPair,
  type AuthenticatedUser,
  type OAuthClientConfig,
} from "@oauth-spa-kit/core";
import { clearPkceStateHeader, readPkceState, writePkceStateHeader } from "./pkceState";
import { clearSessionHeader, readSession, writeSessionHeader, type SessionConfig } from "./session";

export interface OAuthHandlersConfig {
  oauth: OAuthClientConfig;
  session: SessionConfig;
  /**
   * How long before actual expiry to proactively refresh, evaluated on every
   * `/auth/session` call and every `getAuthorizationHeader()` call. Same
   * 60s default oidc-client-ts uses for its browser-side expiring timer --
   * enforced here server-side instead, since the browser never sees the
   * token or its expiry in this pattern.
   */
  refreshThresholdSeconds?: number;
  defaultReturnTo?: string;
  fetchImpl?: typeof fetch;
}

function decodeIdTokenClaims(idToken?: string): AuthenticatedUser | null {
  if (!idToken) return null;
  const payload = idToken.split(".")[1];
  if (!payload) return null;
  try {
    const padded = payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=");
    return JSON.parse(atob(padded)) as AuthenticatedUser;
  } catch {
    return null;
  }
}

async function resolveDiscovery(config: OAuthHandlersConfig) {
  return config.oauth.discoveryDocument
    ?? discoverOidcConfiguration(config.oauth.authority, config.fetchImpl);
}

export function createLoginHandler(config: OAuthHandlersConfig) {
  return async function loginHandler(request: Request): Promise<Response> {
    const discovery = await resolveDiscovery(config);
    const pkce = await createPkceParams();
    const returnTo = new URL(request.url).searchParams.get("returnTo") ?? config.defaultReturnTo ?? "/";

    const authorizeUrl = new URL(discovery.authorization_endpoint);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("client_id", config.oauth.clientId);
    authorizeUrl.searchParams.set("redirect_uri", config.oauth.redirectUri);
    authorizeUrl.searchParams.set("scope", config.oauth.scope);
    authorizeUrl.searchParams.set("state", pkce.state);
    authorizeUrl.searchParams.set("nonce", pkce.nonce);
    authorizeUrl.searchParams.set("code_challenge", pkce.codeChallenge);
    authorizeUrl.searchParams.set("code_challenge_method", pkce.codeChallengeMethod);
    for (const [key, value] of Object.entries(config.oauth.extraAuthorizationParams ?? {})) {
      authorizeUrl.searchParams.set(key, value);
    }

    const setCookie = await writePkceStateHeader(
      { codeVerifier: pkce.codeVerifier, state: pkce.state, nonce: pkce.nonce, returnTo },
      config.session.password,
    );

    return new Response(null, {
      status: 302,
      headers: { Location: authorizeUrl.toString(), "Set-Cookie": setCookie },
    });
  };
}

export function createCallbackHandler(config: OAuthHandlersConfig) {
  return async function callbackHandler(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const error = url.searchParams.get("error");
    if (error) return new Response(`OAuth error: ${error}`, { status: 400 });

    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const pkce = await readPkceState(request, config.session.password);
    if (!code || !state || !pkce || state !== pkce.state) {
      return new Response("Invalid or expired OAuth state -- restart login.", { status: 400 });
    }

    const discovery = await resolveDiscovery(config);
    const dpopKeyPair = config.oauth.dpop ? await generateDpopKeyPair() : undefined;

    const tokens = await exchangeAuthorizationCode({
      config: config.oauth,
      tokenEndpoint: discovery.token_endpoint,
      code,
      codeVerifier: pkce.codeVerifier,
      dpopKeyPair,
      fetchImpl: config.fetchImpl,
    });

    // NOTE: sketch-grade only -- verify the id_token signature (and `nonce`
    // claim against pkce.nonce) using discovery.jwks_uri before trusting
    // these claims in production.
    const user = decodeIdTokenClaims(tokens.idToken) ?? { sub: "unknown" };

    const headers = new Headers({ Location: pkce.returnTo });
    headers.append("Set-Cookie", await writeSessionHeader({ tokens, user }, config.session));
    headers.append("Set-Cookie", clearPkceStateHeader());

    return new Response(null, { status: 302, headers });
  };
}

export function createSessionHandler(config: OAuthHandlersConfig) {
  return async function sessionHandler(request: Request): Promise<Response> {
    const session = await readSession(request, config.session);
    if (!session) {
      return new Response(JSON.stringify({ user: null }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }

    const thresholdMs = (config.refreshThresholdSeconds ?? 60) * 1000;
    const expiringSoon = session.tokens.expiresAt !== null
      && session.tokens.expiresAt - Date.now() < thresholdMs;

    if (!expiringSoon) {
      return new Response(JSON.stringify({ user: session.user }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    if (!session.tokens.refreshToken) {
      return new Response(JSON.stringify({ user: null }), {
        status: 401,
        headers: { "content-type": "application/json", "Set-Cookie": clearSessionHeader(config.session) },
      });
    }

    try {
      const discovery = await resolveDiscovery(config);
      session.tokens = await exchangeRefreshToken({
        config: config.oauth,
        tokenEndpoint: discovery.token_endpoint,
        refreshToken: session.tokens.refreshToken,
        fetchImpl: config.fetchImpl,
      });
      const setCookie = await writeSessionHeader(session, config.session);
      return new Response(JSON.stringify({ user: session.user }), {
        status: 200,
        headers: { "content-type": "application/json", "Set-Cookie": setCookie },
      });
    } catch {
      // Refresh token invalid, rotated-and-reused, or revoked -- force a
      // real re-login rather than silently keep serving a stale session.
      return new Response(JSON.stringify({ user: null }), {
        status: 401,
        headers: { "content-type": "application/json", "Set-Cookie": clearSessionHeader(config.session) },
      });
    }
  };
}

export function createLogoutHandler(config: OAuthHandlersConfig) {
  // Takes a Request, unused, purely so all four handlers share the same
  // `(Request) => Promise<Response>` shape for callers that dispatch on a
  // uniform signature (see examples/react-spa/server.ts).
  return async function logoutHandler(_request: Request): Promise<Response> {
    const headers = new Headers({ "content-type": "application/json" });
    headers.append("Set-Cookie", clearSessionHeader(config.session));

    const discovery = await resolveDiscovery(config).catch(() => null);
    if (discovery?.end_session_endpoint && config.oauth.postLogoutRedirectUri) {
      const endSessionUrl = new URL(discovery.end_session_endpoint);
      endSessionUrl.searchParams.set("client_id", config.oauth.clientId);
      endSessionUrl.searchParams.set("post_logout_redirect_uri", config.oauth.postLogoutRedirectUri);
      headers.set("Location", endSessionUrl.toString());
      return new Response(null, { status: 302, headers });
    }

    return new Response(JSON.stringify({ loggedOut: true }), { status: 200, headers });
  };
}

export interface AuthorizationHeaderResult {
  header: string;
  /** Set only when the token was refreshed -- forward this Set-Cookie on your outgoing response. */
  setCookie?: string;
}

/**
 * For the app's *own* backend routes to call upstream resource servers with
 * a valid token, refreshing transparently if needed. This is the
 * server-side analog of oidc-client-ts's `getUser()` -- the difference is
 * the token never crosses back into the browser.
 */
export async function getAuthorizationHeader(
  request: Request,
  config: OAuthHandlersConfig,
): Promise<AuthorizationHeaderResult | null> {
  const session = await readSession(request, config.session);
  if (!session) return null;

  const thresholdMs = (config.refreshThresholdSeconds ?? 60) * 1000;
  const expiringSoon = session.tokens.expiresAt !== null
    && session.tokens.expiresAt - Date.now() < thresholdMs;

  if (expiringSoon && session.tokens.refreshToken) {
    const discovery = await resolveDiscovery(config);
    session.tokens = await exchangeRefreshToken({
      config: config.oauth,
      tokenEndpoint: discovery.token_endpoint,
      refreshToken: session.tokens.refreshToken,
      fetchImpl: config.fetchImpl,
    });
    const setCookie = await writeSessionHeader(session, config.session);
    return { header: `${session.tokens.tokenType} ${session.tokens.accessToken}`, setCookie };
  }

  return { header: `${session.tokens.tokenType} ${session.tokens.accessToken}` };
}
