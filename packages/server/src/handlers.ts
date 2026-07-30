import {
  computeJwkThumbprint,
  createDpopProof,
  createPkceParams,
  discoverOidcConfiguration,
  exchangeAuthorizationCode,
  exchangeRefreshToken,
  exportDpopKeyPair,
  fetchJwks,
  generateDpopKeyPair,
  importDpopKeyPair,
  parseUserAgent,
  pushAuthorizationRequest,
  verifyJwt,
  OAuthError,
  TokenExchangeError,
  type AuthenticatedUser,
  type OAuthClientConfig,
  type OidcDiscoveryDocument,
} from "@oauth-spa-kit/core";
import { clearPkceStateHeader, readPkceState, writePkceStateHeader } from "./pkceState.js";
import { clearSessionHeader, readSession, writeSessionHeader, type SessionConfig } from "./session.js";

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
  /**
   * Called with the raw thrown error whenever the callback handler's token
   * exchange or id_token verification fails, right before it's collapsed
   * down to a short, URL-safe error code and redirected to
   * `returnTo?login_error=...`. The full error (e.g. TokenExchangeError's
   * `errorDescription`, or a JwtVerificationError's message) is never put in
   * that URL -- it may embed the AS's free-text description -- so without
   * this hook the only way to see *why* a login failed is to re-derive it
   * from the AS's own server-side logs. Optional; defaults to a no-op, so
   * existing consumers see no behavior change.
   */
  onCallbackError?: (error: unknown) => void;
}

async function resolveDiscovery(config: OAuthHandlersConfig): Promise<OidcDiscoveryDocument> {
  return config.oauth.discoveryDocument
    ?? discoverOidcConfiguration(config.oauth.authority, config.fetchImpl);
}

/** OIDC Core section 3.1.3.7 -- verify the id_token's signature and standard claims via the AS's JWKS before trusting anything in it. */
async function verifyIdToken(
  idToken: string | undefined,
  discovery: OidcDiscoveryDocument,
  config: OAuthHandlersConfig,
  expectedNonce: string,
): Promise<AuthenticatedUser> {
  if (!idToken) throw new OAuthError("Token response did not include an id_token");
  if (!discovery.jwks_uri) throw new OAuthError("Discovery document has no jwks_uri -- cannot verify id_token");

  const jwks = await fetchJwks(discovery.jwks_uri, config.fetchImpl);
  const { payload } = await verifyJwt({
    token: idToken,
    jwks,
    expectedIssuer: discovery.issuer,
    expectedAudience: config.oauth.clientId,
    expectedNonce,
  });
  return payload as AuthenticatedUser;
}

export function createLoginHandler(config: OAuthHandlersConfig) {
  return async function loginHandler(request: Request): Promise<Response> {
    const discovery = await resolveDiscovery(config);
    const pkce = await createPkceParams();
    const returnTo = new URL(request.url).searchParams.get("returnTo") ?? config.defaultReturnTo ?? "/";

    // Generated here, not at the callback -- FAPI 2.0's `dpop_jkt` binds the
    // authorization code itself to this key before any token exists, so
    // the same key has to exist before the (pushed) authorization request
    // goes out, and gets carried through the PKCE cookie to the callback.
    const dpopEnabled = config.oauth.dpop !== false;
    const dpopKeyPair = dpopEnabled ? await generateDpopKeyPair() : undefined;

    const authParams: Record<string, string> = {
      response_type: "code",
      redirect_uri: config.oauth.redirectUri,
      scope: config.oauth.scope,
      state: pkce.state,
      nonce: pkce.nonce,
      code_challenge: pkce.codeChallenge,
      code_challenge_method: pkce.codeChallengeMethod,
      ...(config.oauth.extraAuthorizationParams ?? {}),
    };
    if (dpopKeyPair) {
      authParams.dpop_jkt = await computeJwkThumbprint(dpopKeyPair.publicKey);
    }

    const parEnabled = config.oauth.par !== false;
    const authorizeUrl = new URL(discovery.authorization_endpoint);
    authorizeUrl.searchParams.set("client_id", config.oauth.clientId);

    if (parEnabled) {
      if (!discovery.pushed_authorization_request_endpoint) {
        throw new OAuthError(
          "par is enabled (the default) but the discovery document has no pushed_authorization_request_endpoint -- "
          + "set oauth.par = false to fall back to a plain /authorize redirect if your AS doesn't support PAR.",
        );
      }
      const pushed = await pushAuthorizationRequest({
        parEndpoint: discovery.pushed_authorization_request_endpoint,
        clientId: config.oauth.clientId,
        clientAuthentication: config.oauth.clientAuthentication,
        assertionAudience: discovery.issuer,
        params: authParams,
        fetchImpl: config.fetchImpl,
      });
      authorizeUrl.searchParams.set("request_uri", pushed.request_uri);
    } else {
      for (const [key, value] of Object.entries(authParams)) {
        authorizeUrl.searchParams.set(key, value);
      }
    }

    const setCookie = await writePkceStateHeader(
      {
        codeVerifier: pkce.codeVerifier,
        state: pkce.state,
        nonce: pkce.nonce,
        returnTo,
        dpopKeyPair: dpopKeyPair ? await exportDpopKeyPair(dpopKeyPair) : undefined,
      },
      config.session.password,
    );

    return new Response(null, {
      status: 302,
      headers: { Location: authorizeUrl.toString(), "Set-Cookie": setCookie },
    });
  };
}

/**
 * Redirects off the (code-bearing, single-use) callback URL on failure, the
 * same way the success path already redirects to `returnTo` -- never render
 * an error directly on `/auth/callback?code=...`. Leaving the browser parked
 * there means a plain reload resubmits the already-spent `code`, which the
 * AS then (correctly) rejects a second time as `invalid_grant`, forever,
 * until the user manually navigates elsewhere.
 */
function redirectToReturnToWithError(requestUrl: URL, returnTo: string, errorCode: string): Response {
  const target = new URL(returnTo, requestUrl);
  target.searchParams.set("login_error", errorCode);
  return new Response(null, {
    status: 302,
    headers: { Location: target.toString(), "Set-Cookie": clearPkceStateHeader() },
  });
}

export function createCallbackHandler(config: OAuthHandlersConfig) {
  return async function callbackHandler(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const pkce = await readPkceState(request, config.session.password);
    const fallbackReturnTo = pkce?.returnTo ?? config.defaultReturnTo ?? "/";

    const error = url.searchParams.get("error");
    if (error) return redirectToReturnToWithError(url, fallbackReturnTo, error);

    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state || !pkce || state !== pkce.state) {
      return redirectToReturnToWithError(url, fallbackReturnTo, "invalid_state");
    }

    const discovery = await resolveDiscovery(config);
    const dpopKeyPair = pkce.dpopKeyPair ? await importDpopKeyPair(pkce.dpopKeyPair) : undefined;

    // Token exchange and id_token verification talk to the IdP and to
    // untrusted-until-verified JWT parsing -- both are expected to fail
    // sometimes (a replayed/expired code, a misconfigured JWKS). Catch here
    // so the caller always gets back a Response, never an uncaught
    // rejection a raw Web-standard fetch handler has no way to turn into
    // one itself.
    try {
      const tokens = await exchangeAuthorizationCode({
        config: config.oauth,
        tokenEndpoint: discovery.token_endpoint,
        assertionAudience: discovery.issuer,
        code,
        codeVerifier: pkce.codeVerifier,
        dpopKeyPair,
        fetchImpl: config.fetchImpl,
      });

      const user = await verifyIdToken(tokens.idToken, discovery, config, pkce.nonce);
      const device = parseUserAgent(request.headers.get("user-agent"));

      const headers = new Headers({ Location: pkce.returnTo });
      headers.append(
        "Set-Cookie",
        await writeSessionHeader({ tokens, user, dpopKeyPair: pkce.dpopKeyPair, device }, config.session),
      );
      headers.append("Set-Cookie", clearPkceStateHeader());

      return new Response(null, { status: 302, headers });
    } catch (cause) {
      config.onCallbackError?.(cause);
      // Prefer the AS's own OAuth error code (e.g. "invalid_grant") over the
      // full exception message -- short, stable, safe to put in a URL query
      // param; the full message may embed the AS's free-text error_description.
      const errorCode = cause instanceof TokenExchangeError ? cause.error ?? "login_failed" : "login_failed";
      return redirectToReturnToWithError(url, pkce.returnTo, errorCode);
    }
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
      return new Response(JSON.stringify({ user: session.user, device: session.device }), {
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
      const dpopKeyPair = session.dpopKeyPair ? await importDpopKeyPair(session.dpopKeyPair) : undefined;
      session.tokens = await exchangeRefreshToken({
        config: config.oauth,
        tokenEndpoint: discovery.token_endpoint,
        assertionAudience: discovery.issuer,
        refreshToken: session.tokens.refreshToken,
        dpopKeyPair,
        fetchImpl: config.fetchImpl,
      });
      const setCookie = await writeSessionHeader(session, config.session);
      return new Response(JSON.stringify({ user: session.user, device: session.device }), {
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
  return async function logoutHandler(request: Request): Promise<Response> {
    // Read before clearing: id_token_hint (OIDC RP-Initiated Logout 1.0 section 2) is what
    // lets the AS resolve the requesting client and validate/honor post_logout_redirect_uri
    // without an extra confirmation step -- a bare client_id query param proves nothing (any
    // page could set it), so an AS that takes client identity seriously only trusts it when
    // accompanied by the id_token_hint proving this really was that client's session. Without
    // it, expect the AS to fall back to an interactive "are you sure?" prompt and/or drop
    // post_logout_redirect_uri entirely instead of honoring it.
    const session = await readSession(request, config.session);

    const headers = new Headers({ "content-type": "application/json" });
    headers.append("Set-Cookie", clearSessionHeader(config.session));

    const discovery = await resolveDiscovery(config).catch(() => null);
    if (discovery?.end_session_endpoint && config.oauth.postLogoutRedirectUri) {
      const endSessionUrl = new URL(discovery.end_session_endpoint);
      endSessionUrl.searchParams.set("client_id", config.oauth.clientId);
      endSessionUrl.searchParams.set("post_logout_redirect_uri", config.oauth.postLogoutRedirectUri);
      if (session?.tokens.idToken) {
        endSessionUrl.searchParams.set("id_token_hint", session.tokens.idToken);
      }
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
    const dpopKeyPair = session.dpopKeyPair ? await importDpopKeyPair(session.dpopKeyPair) : undefined;
    session.tokens = await exchangeRefreshToken({
      config: config.oauth,
      tokenEndpoint: discovery.token_endpoint,
      assertionAudience: discovery.issuer,
      refreshToken: session.tokens.refreshToken,
      dpopKeyPair,
      fetchImpl: config.fetchImpl,
    });
    const setCookie = await writeSessionHeader(session, config.session);
    return { header: `${session.tokens.tokenType} ${session.tokens.accessToken}`, setCookie };
  }

  return { header: `${session.tokens.tokenType} ${session.tokens.accessToken}` };
}

export interface UserInfoResult {
  /** Whatever the AS's userinfo_endpoint returned -- raw, unmapped claims (shape varies per AS/scope grant). */
  claims: Record<string, unknown>;
  /** Set only when the access token was refreshed -- forward this Set-Cookie on your outgoing response. */
  setCookie?: string;
}

/**
 * Calls the AS's userinfo_endpoint with the session's (DPoP-bound, if
 * enabled) access token, refreshing it first if it's expiring soon -- the
 * id_token is meant to be a thin proof of authentication at login time, not
 * a source of the current profile, which is why this hits userinfo_endpoint
 * rather than just decoding the stored id_token.
 */
export async function getUserInfo(
  request: Request,
  config: OAuthHandlersConfig,
): Promise<UserInfoResult | null> {
  const session = await readSession(request, config.session);
  if (!session) return null;

  const auth = await getAuthorizationHeader(request, config);
  if (!auth) return null;

  const discovery = await resolveDiscovery(config);
  if (!discovery.userinfo_endpoint) {
    throw new OAuthError("Discovery document has no userinfo_endpoint");
  }
  const userinfoEndpoint = discovery.userinfo_endpoint;

  const dpopKeyPair = session.dpopKeyPair ? await importDpopKeyPair(session.dpopKeyPair) : undefined;
  const accessToken = auth.header.slice(auth.header.indexOf(" ") + 1);
  const fetchImpl = config.fetchImpl ?? fetch;

  async function callUserInfo(nonce?: string): Promise<Response> {
    const headers: Record<string, string> = { Authorization: auth!.header };
    if (dpopKeyPair) {
      headers.DPoP = await createDpopProof({ keyPair: dpopKeyPair, htm: "GET", htu: userinfoEndpoint, accessToken, nonce });
    }
    return fetchImpl(userinfoEndpoint, { headers });
  }

  // DPoP resource endpoints can nonce-challenge the same way the token endpoint does (RFC 9449
  // section 8), just via WWW-Authenticate/DPoP-Nonce response headers instead of a JSON body --
  // so this retries once, mirroring the token-endpoint retry in @oauth-spa-kit/core.
  let response = await callUserInfo();
  if (response.status === 401 && dpopKeyPair) {
    const nonce = response.headers.get("DPoP-Nonce");
    if (nonce) response = await callUserInfo(nonce);
  }

  if (!response.ok) {
    throw new OAuthError(`userinfo_endpoint returned ${response.status}`);
  }

  return { claims: (await response.json()) as Record<string, unknown>, setCookie: auth.setCookie };
}

/**
 * For a background liveness-polling loop (e.g. `@oauth-spa-kit/core`'s
 * `createSessionClient` with `livenessCheckIntervalMs` set): a lightweight
 * `{ alive: boolean }` check that, unlike `/auth/session`, always makes a
 * real round trip to the AS's userinfo_endpoint via `getUserInfo` rather than
 * just inspecting the locally stored token expiry -- so it also catches a
 * session that's been revoked or an account that's been deactivated
 * server-side, mid-session, before the access token itself would expire.
 */
export function createLivenessHandler(config: OAuthHandlersConfig) {
  return async function livenessHandler(request: Request): Promise<Response> {
    let result: UserInfoResult | null;
    try {
      result = await getUserInfo(request, config);
    } catch {
      // Any failure here -- a rejected refresh (TokenExchangeError) or the AS's
      // userinfo_endpoint itself rejecting the access token (OAuthError, e.g. the session
      // backing it was explicitly revoked server-side) -- means this session is dead. Clear
      // the local cookie unconditionally rather than only for TokenExchangeError: leaving a
      // known-dead cookie in place is only harmless because the default Nuxt/React wiring
      // immediately redirects to a fresh login on `onSessionExpired`: a consumer that
      // instead just shows a "session expired" message would otherwise keep sending a
      // cookie doomed to fail every subsequent request.
      const headers = new Headers({ "content-type": "application/json" });
      headers.append("Set-Cookie", clearSessionHeader(config.session));
      return new Response(JSON.stringify({ alive: false }), { status: 401, headers });
    }

    if (!result) {
      return new Response(JSON.stringify({ alive: false }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }

    const headers = new Headers({ "content-type": "application/json" });
    if (result.setCookie) headers.append("Set-Cookie", result.setCookie);
    return new Response(JSON.stringify({ alive: true }), { status: 200, headers });
  };
}
