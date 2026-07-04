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
  pushed_authorization_request_endpoint?: string;
  require_pushed_authorization_requests?: boolean;
}

import type { JwtAlgorithm } from "./jwt";

/**
 * Confidential-client authentication to the token endpoint, via a signed
 * JWT assertion (RFC 7523 `private_key_jwt`) -- never a shared
 * `client_secret`. This kit is built for FAPI 2.0 Security Profile and FIPS
 * 140 compliance, both of which rule out shared-secret client
 * authentication entirely: a `client_secret` is a long-lived bearer value
 * that has to be transmitted and stored, where a private key signs an
 * assertion without ever leaving this server.
 */
export interface ClientAuthentication {
  method: "private_key_jwt";
  /** Non-extractable if generated via `crypto.subtle.generateKey`; imported keys should be non-extractable too. */
  privateKey: CryptoKey;
  /** `kid` header claim, if your JWKS exposes more than one key. */
  keyId?: string;
  /** PS256 (RSA-PSS) or ES256 (ECDSA P-256) only -- see jwt.ts for why RS256 is excluded. Defaults to "ES256". */
  alg?: JwtAlgorithm;
  /** Assertion validity window. Keep short -- this is a bearer credential for its lifetime. Defaults to 60s. */
  assertionLifetimeSeconds?: number;
}

export interface OAuthClientConfig {
  /** Issuer base URL. Used for discovery unless `discoveryDocument` is provided directly. */
  authority: string;
  clientId: string;
  clientAuthentication: ClientAuthentication;
  redirectUri: string;
  postLogoutRedirectUri?: string;
  scope: string;
  /** Pre-fetched discovery document, to skip the discovery round trip. */
  discoveryDocument?: OidcDiscoveryDocument;
  /**
   * RFC 9449 DPoP sender-constrained tokens. **Defaults to `true`** --
   * required by FAPI 2.0 for confidential clients (DPoP or mTLS; this kit
   * only implements DPoP). Set explicitly to `false` only if your
   * authorization server does not support DPoP at all.
   */
  dpop?: boolean;
  /**
   * RFC 9126 Pushed Authorization Requests. **Defaults to `true`** --
   * required by FAPI 2.0. Set explicitly to `false` only if your
   * authorization server has no `pushed_authorization_request_endpoint`.
   */
  par?: boolean;
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
