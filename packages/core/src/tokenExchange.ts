import { createDpopProof, type DpopKeyPair } from "./dpop";
import { TokenExchangeError } from "./errors";
import type { OAuthClientConfig, TokenResponse, TokenSet } from "./types";

export function toTokenSet(response: TokenResponse): TokenSet {
  return {
    accessToken: response.access_token,
    tokenType: response.token_type,
    expiresAt: response.expires_in !== undefined ? Date.now() + response.expires_in * 1000 : null,
    refreshToken: response.refresh_token,
    idToken: response.id_token,
    scope: response.scope,
  };
}

async function postToken(
  tokenEndpoint: string,
  params: URLSearchParams,
  opts: { dpopKeyPair?: DpopKeyPair; fetchImpl?: typeof fetch } = {},
): Promise<TokenResponse> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (opts.dpopKeyPair) {
    headers["DPoP"] = await createDpopProof({
      keyPair: opts.dpopKeyPair,
      htm: "POST",
      htu: tokenEndpoint,
    });
  }

  const response = await fetchImpl(tokenEndpoint, { method: "POST", headers, body: params });
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new TokenExchangeError(
      `Token endpoint returned ${response.status}: ${body.error ?? "unknown_error"}`,
      body.error,
      body.error_description,
    );
  }
  return body as TokenResponse;
}

export interface ExchangeAuthorizationCodeArgs {
  config: OAuthClientConfig;
  tokenEndpoint: string;
  code: string;
  codeVerifier: string;
  dpopKeyPair?: DpopKeyPair;
  fetchImpl?: typeof fetch;
}

/** RFC 6749 section 4.1.3 -- authorization_code grant, PKCE-verified. */
export async function exchangeAuthorizationCode(args: ExchangeAuthorizationCodeArgs): Promise<TokenSet> {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: args.config.clientId,
    code: args.code,
    redirect_uri: args.config.redirectUri,
    code_verifier: args.codeVerifier,
  });
  if (args.config.clientSecret) params.set("client_secret", args.config.clientSecret);

  const response = await postToken(args.tokenEndpoint, params, {
    dpopKeyPair: args.dpopKeyPair,
    fetchImpl: args.fetchImpl,
  });
  return toTokenSet(response);
}

export interface ExchangeRefreshTokenArgs {
  config: OAuthClientConfig;
  tokenEndpoint: string;
  refreshToken: string;
  dpopKeyPair?: DpopKeyPair;
  fetchImpl?: typeof fetch;
}

/**
 * RFC 6749 section 6 -- refresh_token grant.
 *
 * Always prefer this over a fresh interactive/silent-iframe login when a
 * refresh token is available (same choice oidc-client-ts's
 * `signinSilent()` makes) -- it's one round trip instead of a full
 * redirect/iframe navigation, and doesn't depend on third-party-cookie
 * access, which browsers increasingly restrict for `prompt=none` iframe
 * flows. If your authorization server rotates refresh tokens (recommended
 * for public clients per OAuth 2.1), always persist the *new*
 * `refresh_token` from the response -- the old one is invalidated on use
 * and reuse is treated as token theft.
 */
export async function exchangeRefreshToken(args: ExchangeRefreshTokenArgs): Promise<TokenSet> {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: args.config.clientId,
    refresh_token: args.refreshToken,
  });
  if (args.config.clientSecret) params.set("client_secret", args.config.clientSecret);

  const response = await postToken(args.tokenEndpoint, params, {
    dpopKeyPair: args.dpopKeyPair,
    fetchImpl: args.fetchImpl,
  });
  const tokenSet = toTokenSet(response);
  // Some servers omit refresh_token on renewal, meaning "unchanged" -- carry the old one forward.
  if (!tokenSet.refreshToken) tokenSet.refreshToken = args.refreshToken;
  return tokenSet;
}
