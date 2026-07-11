import { buildClientAssertionParams } from "./clientAssertion.js";
import { OAuthError } from "./errors.js";
import type { ClientAuthentication } from "./types.js";

/**
 * RFC 9126 Pushed Authorization Requests -- required by FAPI 2.0. Instead
 * of redirecting the browser to `/authorize` with every parameter
 * (state, PKCE challenge, scope, ...) sitting in the URL -- visible in
 * browser history, the `Referer` header, and server access logs -- the
 * client POSTs those parameters directly to the AS, authenticated, and
 * gets back a short-lived, single-use `request_uri` that the browser
 * redirect then carries instead.
 */

export interface PushAuthorizationRequestArgs {
  parEndpoint: string;
  clientId: string;
  clientAuthentication: ClientAuthentication;
  /** Client assertion `aud` -- pass the AS's issuer identifier (rfc7523bis section 4 mandates this as the sole value; see `buildClientAssertionParams`). */
  assertionAudience: string;
  /** Authorization request parameters (response_type, redirect_uri, scope, state, nonce, code_challenge, code_challenge_method, and any extras) -- everything that would otherwise go on the `/authorize` query string. */
  params: Record<string, string>;
  fetchImpl?: typeof fetch;
}

export interface PushedAuthorizationResponse {
  request_uri: string;
  expires_in: number;
}

export async function pushAuthorizationRequest(
  args: PushAuthorizationRequestArgs,
): Promise<PushedAuthorizationResponse> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const assertionParams = await buildClientAssertionParams(
    args.clientId,
    args.clientAuthentication,
    args.assertionAudience,
  );

  const body = new URLSearchParams({
    client_id: args.clientId,
    ...args.params,
    ...assertionParams,
  });

  const response = await fetchImpl(args.parEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new OAuthError(
      `PAR endpoint returned ${response.status}: ${json.error ?? "unknown_error"} ${json.error_description ?? ""}`.trim(),
    );
  }
  return json as PushedAuthorizationResponse;
}
