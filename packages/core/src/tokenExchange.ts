import { buildClientAssertionParams } from "./clientAssertion";
import { createDpopProof, generateDpopKeyPair, type DpopKeyPair } from "./dpop";
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

interface PostTokenArgs {
  tokenEndpoint: string;
  params: URLSearchParams;
  dpopKeyPair?: DpopKeyPair;
  fetchImpl: typeof fetch;
}

interface TokenErrorBody {
  error?: string;
  error_description?: string;
}

async function postTokenOnce(
  { tokenEndpoint, params, dpopKeyPair, fetchImpl }: PostTokenArgs,
  dpopNonce?: string,
): Promise<{ response: Response; body: TokenErrorBody & Partial<TokenResponse> }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (dpopKeyPair) {
    headers["DPoP"] = await createDpopProof({
      keyPair: dpopKeyPair,
      htm: "POST",
      htu: tokenEndpoint,
      nonce: dpopNonce,
    });
  }

  const response = await fetchImpl(tokenEndpoint, { method: "POST", headers, body: params });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

/**
 * POSTs a token request, retrying exactly once if the server challenges
 * with `error: "use_dpop_nonce"` + a `DPoP-Nonce` response header (RFC 9449
 * section 8) -- a server-provided nonce the proof must echo back. Servers
 * that don't require a nonce never trigger this path.
 */
async function postToken(args: PostTokenArgs): Promise<TokenResponse> {
  let { response, body } = await postTokenOnce(args);

  if (!response.ok && body.error === "use_dpop_nonce" && args.dpopKeyPair) {
    const nonce = response.headers.get("DPoP-Nonce");
    if (!nonce) {
      throw new TokenExchangeError(
        "Server returned use_dpop_nonce but no DPoP-Nonce header to retry with",
        body.error,
        body.error_description,
      );
    }
    ({ response, body } = await postTokenOnce(args, nonce));
  }

  if (!response.ok || !body.access_token || !body.token_type) {
    throw new TokenExchangeError(
      `Token endpoint returned ${response.status}: ${body.error ?? "unknown_error"}`,
      body.error,
      body.error_description,
    );
  }
  // Narrowed by the access_token/token_type check above.
  return body as TokenResponse;
}

export interface ExchangeAuthorizationCodeArgs {
  config: OAuthClientConfig;
  tokenEndpoint: string;
  code: string;
  codeVerifier: string;
  /** Reuse the same key pair used to bind the authorization request, if DPoP was used there too. A fresh one is generated if omitted and `config.dpop !== false`. */
  dpopKeyPair?: DpopKeyPair;
  fetchImpl?: typeof fetch;
}

/** RFC 6749 section 4.1.3 -- authorization_code grant, PKCE-verified, private_key_jwt-authenticated. */
export async function exchangeAuthorizationCode(args: ExchangeAuthorizationCodeArgs): Promise<TokenSet> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const assertionParams = await buildClientAssertionParams(
    args.config.clientId,
    args.config.clientAuthentication,
    args.tokenEndpoint,
  );
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: args.config.clientId,
    code: args.code,
    redirect_uri: args.config.redirectUri,
    code_verifier: args.codeVerifier,
    ...assertionParams,
  });

  const dpopKeyPair = args.config.dpop === false
    ? undefined
    : args.dpopKeyPair ?? await generateDpopKeyPair();

  const response = await postToken({ tokenEndpoint: args.tokenEndpoint, params, dpopKeyPair, fetchImpl });
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
 * Always prefer this over a fresh interactive login when a refresh token
 * is available (same choice `oidc-client-ts`'s `signinSilent()` makes) --
 * one round trip instead of a full redirect, and no dependency on
 * third-party-cookie access, which browsers increasingly restrict for
 * `prompt=none` iframe flows. If your authorization server rotates refresh
 * tokens (expected for public/BFF clients per OAuth 2.1), always persist
 * the *new* `refresh_token` from the response -- the old one is
 * invalidated on use, and reuse of an already-consumed refresh token is a
 * signal of theft, not a retry-safe condition.
 */
export async function exchangeRefreshToken(args: ExchangeRefreshTokenArgs): Promise<TokenSet> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const assertionParams = await buildClientAssertionParams(
    args.config.clientId,
    args.config.clientAuthentication,
    args.tokenEndpoint,
  );
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: args.config.clientId,
    refresh_token: args.refreshToken,
    ...assertionParams,
  });

  const dpopKeyPair = args.config.dpop === false
    ? undefined
    : args.dpopKeyPair ?? await generateDpopKeyPair();

  const response = await postToken({ tokenEndpoint: args.tokenEndpoint, params, dpopKeyPair, fetchImpl });
  const tokenSet = toTokenSet(response);
  // Some servers omit refresh_token on renewal, meaning "unchanged" -- carry the old one forward.
  if (!tokenSet.refreshToken) tokenSet.refreshToken = args.refreshToken;
  return tokenSet;
}
