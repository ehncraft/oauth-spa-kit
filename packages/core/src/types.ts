/**
 * Static or discovered OIDC provider metadata (subset of the discovery doc
 * we actually use -- see https://openid.net/specs/openid-connect-discovery-1_0.html).
 */
export interface OidcDiscoveryDocument {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  end_session_endpoint?: string;
  jwks_uri?: string;
  userinfo_endpoint?: string;
}

export interface OAuthClientConfig {
  /** Issuer base URL. Used for discovery unless `discoveryDocument` is provided directly. */
  authority: string;
  clientId: string;
  /** Public clients (SPAs) must not use a client secret -- confidential-client BFF flows may set this server-side only. */
  clientSecret?: string;
  redirectUri: string;
  postLogoutRedirectUri?: string;
  scope: string;
  /** Pre-fetched discovery document, to skip the discovery round trip. */
  discoveryDocument?: OidcDiscoveryDocument;
  /**
   * RFC 9449 DPoP sender-constrained tokens. Recommended over bearer tokens
   * wherever the authorization server supports it -- a stolen access/refresh
   * token is useless without the private key that never leaves this client.
   */
  dpop?: boolean;
  extraAuthorizationParams?: Record<string, string>;
}

/** Raw token endpoint response (RFC 6749 section 5.1). */
export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  id_token?: string;
  scope?: string;
}

/** Normalized token set with an absolute expiry, as stored server-side (BFF) or in memory (public client). */
export interface TokenSet {
  accessToken: string;
  tokenType: string;
  /** Epoch milliseconds. Absolute, so it survives serialization/storage without recomputation drift. */
  expiresAt: number | null;
  refreshToken?: string;
  idToken?: string;
  scope?: string;
}

export interface AuthenticatedUser {
  sub: string;
  [claim: string]: unknown;
}

export interface SessionState {
  ready: boolean;
  loggedIn: boolean;
  user: AuthenticatedUser | null;
}
