import { describe, expect, it, vi } from "vitest";
import {
  OAuthError,
  computeJwkThumbprint,
  importDpopKeyPair,
  signJwt,
  type OidcDiscoveryDocument,
} from "@oauth-spa-kit/core";
import {
  createCallbackHandler,
  createLoginHandler,
  createLogoutHandler,
  createSessionHandler,
  getAuthorizationHeader,
  type OAuthHandlersConfig,
} from "../src/handlers";
import { readPkceState } from "../src/pkceState";
import { requestWithCookies } from "./testUtils";

/** Real shape of every `fetchImpl` call in this file's mocks -- avoids re-annotating a mismatched tuple at every call site. */
type FetchCall = [string, { headers: Record<string, string>; body?: string }];

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function decodeJwtPart(part: string): Record<string, unknown> {
  return JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=")));
}

function dpopProofJwkX(headers: Headers | Record<string, string>): string | undefined {
  const proof = headers instanceof Headers ? headers.get("DPoP") : headers.DPoP;
  if (!proof) return undefined;
  return (decodeJwtPart(proof.split(".")[0]).jwk as { x: string }).x;
}

/**
 * A minimal mocked authorization server: PAR + token + JWKS + (implicitly)
 * end_session, matching `discovery` below.
 *
 * Every URL is namespaced with a random per-call suffix, deliberately --
 * `@oauth-spa-kit/core`'s discovery/JWKS fetches are cached at module scope
 * keyed by URL (correct for production; a real issuer's JWKS doesn't
 * change every request). Vitest runs every `it()` in this file against
 * that same shared module instance, so two tests both claiming to be
 * "https://as.example" would collide in that cache and verify id_tokens
 * against a stale key from an earlier test.
 */
async function setupMockAs() {
  const asKeyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const asPublicJwk = await crypto.subtle.exportKey("jwk", asKeyPair.publicKey);
  const origin = `https://as-${Math.random().toString(36).slice(2)}.example`;

  const discovery: OidcDiscoveryDocument = {
    issuer: origin,
    authorization_endpoint: `${origin}/authorize`,
    token_endpoint: `${origin}/token`,
    pushed_authorization_request_endpoint: `${origin}/par`,
    jwks_uri: `${origin}/jwks`,
    end_session_endpoint: `${origin}/logout`,
  };

  let capturedNonce: string | undefined;
  let capturedDpopJkt: string | undefined;
  let refreshCount = 0;

  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;

    if (url === discovery.pushed_authorization_request_endpoint) {
      const body = new URLSearchParams(init!.body as string);
      capturedNonce = body.get("nonce") ?? undefined;
      capturedDpopJkt = body.get("dpop_jkt") ?? undefined;
      return jsonResponse({ request_uri: "urn:ietf:params:oauth:request_uri:test123", expires_in: 90 });
    }

    if (url === discovery.jwks_uri) {
      return jsonResponse({ keys: [{ ...asPublicJwk, kid: "as-key-1" }] });
    }

    if (url === discovery.token_endpoint) {
      const body = new URLSearchParams(init!.body as string);
      const grantType = body.get("grant_type");

      if (grantType === "authorization_code") {
        if (body.get("code") !== "valid-code") return jsonResponse({ error: "invalid_grant" }, 400);
        const idToken = await signJwt({
          header: { kid: "as-key-1" },
          payload: {
            iss: discovery.issuer,
            aud: "client-1",
            sub: "user-1",
            nonce: capturedNonce,
            exp: Math.floor(Date.now() / 1000) + 300,
          },
          privateKey: asKeyPair.privateKey,
          alg: "ES256",
        });
        return jsonResponse({
          access_token: "at-1",
          token_type: "DPoP",
          expires_in: 3600,
          refresh_token: "rt-1",
          id_token: idToken,
          _dpopJwkX: dpopProofJwkX(headers), // smuggled out for assertions only
        });
      }

      if (grantType === "refresh_token") {
        refreshCount++;
        if (body.get("refresh_token") === "revoked-rt") return jsonResponse({ error: "invalid_grant" }, 400);
        return jsonResponse({
          access_token: `at-refreshed-${refreshCount}`,
          token_type: "DPoP",
          expires_in: 3600,
          _dpopJwkX: dpopProofJwkX(headers),
        });
      }
    }

    throw new Error(`Unexpected fetch to ${url}`);
  });

  return { discovery, fetchImpl, getCapturedDpopJkt: () => capturedDpopJkt };
}

async function setup(overrides: Partial<OAuthHandlersConfig["oauth"]> = {}) {
  const { privateKey } = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const { discovery, fetchImpl, getCapturedDpopJkt } = await setupMockAs();

  const config: OAuthHandlersConfig = {
    oauth: {
      authority: discovery.issuer,
      clientId: "client-1",
      clientAuthentication: { method: "private_key_jwt", privateKey, alg: "ES256" },
      redirectUri: "https://app.example/auth/callback",
      postLogoutRedirectUri: "https://app.example",
      scope: "openid",
      discoveryDocument: discovery,
      ...overrides,
    },
    session: { password: "b".repeat(32) },
    defaultReturnTo: "/",
    fetchImpl,
  };

  return { config, fetchImpl, getCapturedDpopJkt };
}

/** Drives login -> callback and returns the resulting session Set-Cookie. */
async function loginAndCallback(config: OAuthHandlersConfig, code = "valid-code") {
  const login = createLoginHandler(config);
  const loginResponse = await login(new Request("https://app.example/auth/login?returnTo=/dashboard"));
  const pkceCookie = loginResponse.headers.get("Set-Cookie")!;

  const loginUrl = new URL(loginResponse.headers.get("Location")!);
  const state = new URLSearchParams(await extractPushedParams(config)).get("state");

  const callback = createCallbackHandler(config);
  const callbackRequest = requestWithCookies(
    `https://app.example/auth/callback?code=${code}&state=${state}`,
    pkceCookie,
  );
  const callbackResponse = await callback(callbackRequest);
  return { loginResponse, loginUrl, callbackResponse };
}

// The mocked PAR endpoint doesn't hand back the pushed params, so pull the
// last-pushed `state` off the fetch mock's call history instead.
async function extractPushedParams(config: OAuthHandlersConfig): Promise<string> {
  const fetchImpl = config.fetchImpl as ReturnType<typeof vi.fn>;
  const calls = fetchImpl.mock.calls as FetchCall[];
  const parCall = calls.find(([url]) => url.endsWith("/par"));
  return parCall![1].body as string;
}

/** Pulls the most recent /token request body off the fetch mock's call history. */
function extractLastTokenParams(config: OAuthHandlersConfig): string {
  const fetchImpl = config.fetchImpl as ReturnType<typeof vi.fn>;
  const calls = fetchImpl.mock.calls as FetchCall[];
  const tokenCalls = calls.filter(([url]) => url.endsWith("/token"));
  return tokenCalls.at(-1)![1].body as string;
}

describe("createLoginHandler", () => {
  it("pushes the authorization request (PAR) and redirects with only client_id + request_uri", async () => {
    const { config, fetchImpl } = await setup();
    const login = createLoginHandler(config);
    const response = await login(new Request("https://app.example/auth/login"));

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("Location")!);
    expect(location.searchParams.get("client_id")).toBe("client-1");
    expect(location.searchParams.get("request_uri")).toBe("urn:ietf:params:oauth:request_uri:test123");
    expect(location.searchParams.has("state")).toBe(false);
    expect(location.searchParams.has("code_challenge")).toBe(false);
    expect(fetchImpl).toHaveBeenCalledWith(config.oauth.discoveryDocument!.pushed_authorization_request_endpoint, expect.anything());
    expect(response.headers.get("Set-Cookie")).toMatch(/^__oauth_pkce=/);
  });

  it("binds the authorization request to the DPoP key via dpop_jkt", async () => {
    const { config, getCapturedDpopJkt } = await setup();
    const login = createLoginHandler(config);
    const response = await login(new Request("https://app.example/auth/login"));
    const pkceCookie = response.headers.get("Set-Cookie")!;

    const pkce = (await readPkceState(requestWithCookies("https://app.example", pkceCookie), config.session.password))!;
    const keyPair = await importDpopKeyPair(pkce.dpopKeyPair!);
    const actualThumbprint = await computeJwkThumbprint(keyPair.publicKey);

    expect(getCapturedDpopJkt()).toBe(actualThumbprint);
  });

  it("falls back to a plain /authorize redirect when par is disabled", async () => {
    const { config, fetchImpl } = await setup({ par: false });
    const login = createLoginHandler(config);
    const response = await login(new Request("https://app.example/auth/login"));

    const location = new URL(response.headers.get("Location")!);
    expect(location.searchParams.get("response_type")).toBe("code");
    expect(location.searchParams.has("code_challenge")).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("throws if par is enabled (default) but the AS has no PAR endpoint", async () => {
    const { config } = await setup();
    config.oauth.discoveryDocument = { ...config.oauth.discoveryDocument!, pushed_authorization_request_endpoint: undefined };
    const login = createLoginHandler(config);
    await expect(login(new Request("https://app.example/auth/login"))).rejects.toThrow(OAuthError);
  });

  it("authenticates the PAR request with a client assertion audienced to the issuer, not the PAR endpoint (rfc7523bis)", async () => {
    const { config } = await setup();
    const login = createLoginHandler(config);
    await login(new Request("https://app.example/auth/login"));

    const body = new URLSearchParams(await extractPushedParams(config));
    const assertion = body.get("client_assertion")!;
    const payload = decodeJwtPart(assertion.split(".")[1]);
    expect(payload.aud).toBe(config.oauth.discoveryDocument!.issuer);
  });
});

describe("createCallbackHandler", () => {
  it("completes the full login -> PAR -> callback flow with a JWKS-verified id_token", async () => {
    const { config } = await setup();
    const { callbackResponse } = await loginAndCallback(config);

    expect(callbackResponse.status).toBe(302);
    expect(callbackResponse.headers.get("Location")).toBe("/dashboard");
    const setCookies = callbackResponse.headers.getSetCookie();
    expect(setCookies.some((c) => c.startsWith("__session="))).toBe(true);
    expect(setCookies.some((c) => c.startsWith("__oauth_pkce=") && c.includes("Max-Age=0"))).toBe(true);
  });

  it("authenticates the code exchange with a client assertion audienced to the issuer, not the token endpoint (rfc7523bis)", async () => {
    const { config } = await setup();
    await loginAndCallback(config);

    const body = new URLSearchParams(extractLastTokenParams(config));
    const assertion = body.get("client_assertion")!;
    const payload = decodeJwtPart(assertion.split(".")[1]);
    expect(payload.aud).toBe(config.oauth.discoveryDocument!.issuer);
  });

  it("exposes the verified id_token claims via /auth/session", async () => {
    const { config } = await setup();
    const { callbackResponse } = await loginAndCallback(config);
    const sessionCookie = callbackResponse.headers.getSetCookie().find((c) => c.startsWith("__session="))!;

    const session = createSessionHandler(config);
    const response = await session(requestWithCookies("https://app.example/auth/session", sessionCookie));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.user).toMatchObject({ sub: "user-1" });
  });

  it("rejects a mismatched state", async () => {
    const { config } = await setup();
    const login = createLoginHandler(config);
    const loginResponse = await login(new Request("https://app.example/auth/login"));
    const pkceCookie = loginResponse.headers.get("Set-Cookie")!;

    const callback = createCallbackHandler(config);
    const response = await callback(
      requestWithCookies("https://app.example/auth/callback?code=valid-code&state=wrong-state", pkceCookie),
    );
    expect(response.status).toBe(400);
  });

  it("surfaces an OAuth error param as a 400", async () => {
    const { config } = await setup();
    const callback = createCallbackHandler(config);
    const response = await callback(new Request("https://app.example/auth/callback?error=access_denied"));
    expect(response.status).toBe(400);
  });

  it("rejects a token exchange for an invalid code", async () => {
    const { config } = await setup();
    const { callbackResponse } = await loginAndCallback(config, "wrong-code");
    expect(callbackResponse.status).toBe(400);
  });
});

describe("createSessionHandler refresh", () => {
  it("refreshes with the same DPoP key that obtained the original tokens", async () => {
    const { config, fetchImpl } = await setup();
    const { callbackResponse } = await loginAndCallback(config);
    const sessionCookie = callbackResponse.headers.getSetCookie().find((c) => c.startsWith("__session="))!;

    // Force the stored session to look expired so the session handler refreshes,
    // without disturbing the DPoP key pair it carries.
    const { readSession, writeSessionHeader } = await import("../src/session");
    const stored = (await readSession(requestWithCookies("https://app.example", sessionCookie), config.session))!;
    stored.tokens.expiresAt = Date.now() - 1000;
    const expiredSessionCookie = await writeSessionHeader(stored, config.session);

    const session = createSessionHandler({ ...config, refreshThresholdSeconds: 999_999 });
    const response = await session(requestWithCookies("https://app.example/auth/session", expiredSessionCookie));
    expect(response.status).toBe(200);

    const tokenEndpoint = config.oauth.discoveryDocument!.token_endpoint;
    const tokenCalls = (fetchImpl.mock.calls as FetchCall[]).filter(([url]) => url === tokenEndpoint);
    expect(tokenCalls).toHaveLength(2); // authorization_code, then refresh_token
    const [, initialInit] = tokenCalls[0];
    const [, refreshInit] = tokenCalls[1];
    expect(dpopProofJwkX(refreshInit.headers)).toBe(dpopProofJwkX(initialInit.headers));

    // rfc7523bis: the refresh's client assertion must be audienced to the
    // issuer too, same as the original code exchange.
    const refreshAssertion = new URLSearchParams(refreshInit.body).get("client_assertion")!;
    expect(decodeJwtPart(refreshAssertion.split(".")[1]).aud).toBe(config.oauth.discoveryDocument!.issuer);
  });

  it("clears the session and returns 401 when the refresh token is revoked", async () => {
    const { config } = await setup();
    const badSession: OAuthHandlersConfig = { ...config, refreshThresholdSeconds: 999_999 };
    const { writeSessionHeader } = await import("../src/session");
    const setCookie = await writeSessionHeader(
      { tokens: { accessToken: "at", tokenType: "DPoP", expiresAt: Date.now() - 1000, refreshToken: "revoked-rt" }, user: { sub: "u1" } },
      config.session,
    );

    const session = createSessionHandler(badSession);
    const response = await session(requestWithCookies("https://app.example/auth/session", setCookie));
    expect(response.status).toBe(401);
    expect(response.headers.get("Set-Cookie")).toContain("Max-Age=0");
  });

  it("returns 401 with no refresh attempt when there is no refresh_token", async () => {
    const { config, fetchImpl } = await setup();
    const { writeSessionHeader } = await import("../src/session");
    const setCookie = await writeSessionHeader(
      { tokens: { accessToken: "at", tokenType: "DPoP", expiresAt: Date.now() - 1000 }, user: { sub: "u1" } },
      config.session,
    );
    fetchImpl.mockClear();

    const session = createSessionHandler({ ...config, refreshThresholdSeconds: 999_999 });
    const response = await session(requestWithCookies("https://app.example/auth/session", setCookie));
    expect(response.status).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns 401 with no session cookie at all", async () => {
    const { config } = await setup();
    const session = createSessionHandler(config);
    const response = await session(new Request("https://app.example/auth/session"));
    expect(response.status).toBe(401);
  });
});

describe("createLogoutHandler", () => {
  it("clears the session and redirects to end_session_endpoint", async () => {
    const { config } = await setup();
    const logout = createLogoutHandler(config);
    const response = await logout(new Request("https://app.example/auth/logout", { method: "POST" }));

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("Location")!);
    expect(location.origin + location.pathname).toBe(config.oauth.discoveryDocument!.end_session_endpoint);
    expect(location.searchParams.get("client_id")).toBe("client-1");
    expect(response.headers.get("Set-Cookie")).toContain("Max-Age=0");
  });
});

describe("getAuthorizationHeader", () => {
  it("returns the current token header without refreshing when not expiring", async () => {
    const { config, fetchImpl } = await setup();
    const { callbackResponse } = await loginAndCallback(config);
    const sessionCookie = callbackResponse.headers.getSetCookie().find((c) => c.startsWith("__session="))!;
    fetchImpl.mockClear();

    const result = await getAuthorizationHeader(
      requestWithCookies("https://app.example/api/whatever", sessionCookie),
      config,
    );
    expect(result?.header).toBe("DPoP at-1");
    expect(result?.setCookie).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refreshes and returns an updated Set-Cookie when the token is expiring", async () => {
    const { config } = await setup();
    const { writeSessionHeader } = await import("../src/session");
    const setCookie = await writeSessionHeader(
      { tokens: { accessToken: "at-old", tokenType: "DPoP", expiresAt: Date.now() - 1000, refreshToken: "rt-1" }, user: { sub: "u1" } },
      config.session,
    );

    const result = await getAuthorizationHeader(
      requestWithCookies("https://app.example/api/whatever", setCookie),
      { ...config, refreshThresholdSeconds: 999_999 },
    );
    expect(result?.header).toBe("DPoP at-refreshed-1");
    expect(result?.setCookie).toBeTruthy();
  });

  it("returns null with no session", async () => {
    const { config } = await setup();
    expect(await getAuthorizationHeader(new Request("https://app.example/api/whatever"), config)).toBeNull();
  });
});
