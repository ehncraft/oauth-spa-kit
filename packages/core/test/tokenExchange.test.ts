import { describe, expect, it, vi } from "vitest";
import {
  TokenExchangeError,
  exchangeAuthorizationCode,
  exchangeRefreshToken,
  generateDpopKeyPair,
  type OAuthClientConfig,
} from "@oauth-spa-kit/core";

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  return JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
}

async function baseConfig(overrides: Partial<OAuthClientConfig> = {}): Promise<OAuthClientConfig> {
  const { privateKey } = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  return {
    authority: "https://as.example",
    clientId: "client-1",
    clientAuthentication: { method: "private_key_jwt", privateKey, alg: "ES256" },
    redirectUri: "https://app.example/callback",
    scope: "openid",
    ...overrides,
  };
}

describe("exchangeAuthorizationCode", () => {
  it("sends a DPoP proof by default and maps the response to a TokenSet", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ access_token: "at", token_type: "DPoP", expires_in: 3600, refresh_token: "rt", id_token: "idt" }),
    );

    const tokens = await exchangeAuthorizationCode({
      config: await baseConfig(),
      tokenEndpoint: "https://as.example/token",
      assertionAudience: "https://as.example",
      code: "code-1",
      codeVerifier: "verifier-1",
      fetchImpl,
    });

    expect(tokens).toMatchObject({ accessToken: "at", tokenType: "DPoP", refreshToken: "rt", idToken: "idt" });
    expect(tokens.expiresAt).toBeGreaterThan(Date.now());

    const [, init] = fetchImpl.mock.calls[0];
    expect(init.headers.DPoP).toBeTypeOf("string");
    const body = new URLSearchParams(init.body as URLSearchParams);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("code-1");
    expect(body.get("code_verifier")).toBe("verifier-1");
    expect(body.get("client_assertion")).toBeTruthy();
    expect(body.has("client_secret")).toBe(false);
  });

  it("audiences the client assertion to assertionAudience, not the token endpoint (rfc7523bis)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ access_token: "at", token_type: "DPoP", expires_in: 3600 }));
    await exchangeAuthorizationCode({
      config: await baseConfig(),
      tokenEndpoint: "https://as.example/token",
      assertionAudience: "https://as.example",
      code: "code-1",
      codeVerifier: "verifier-1",
      fetchImpl,
    });
    const [, init] = fetchImpl.mock.calls[0];
    const body = new URLSearchParams(init.body as URLSearchParams);
    const payload = decodeJwtPayload(body.get("client_assertion")!);
    expect(payload.aud).toBe("https://as.example");
  });

  it("omits the DPoP header when config.dpop === false", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ access_token: "at", token_type: "Bearer", expires_in: 3600 }),
    );
    await exchangeAuthorizationCode({
      config: await baseConfig({ dpop: false }),
      tokenEndpoint: "https://as.example/token",
      assertionAudience: "https://as.example",
      code: "code-1",
      codeVerifier: "verifier-1",
      fetchImpl,
    });
    const [, init] = fetchImpl.mock.calls[0];
    expect(init.headers.DPoP).toBeUndefined();
  });

  it("retries exactly once against a use_dpop_nonce challenge, echoing the server nonce", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: "use_dpop_nonce" }, 400, { "DPoP-Nonce": "srv-nonce-1" }))
      .mockResolvedValueOnce(jsonResponse({ access_token: "at", token_type: "DPoP", expires_in: 3600 }));

    const tokens = await exchangeAuthorizationCode({
      config: await baseConfig(),
      tokenEndpoint: "https://as.example/token",
      assertionAudience: "https://as.example",
      code: "code-1",
      codeVerifier: "verifier-1",
      fetchImpl,
    });

    expect(tokens.accessToken).toBe("at");
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const secondProof = fetchImpl.mock.calls[1][1].headers.DPoP as string;
    const payload = JSON.parse(atob(secondProof.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    expect(payload.nonce).toBe("srv-nonce-1");
  });

  it("throws TokenExchangeError with the server's error/description on failure", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: "invalid_grant", error_description: "expired code" }, 400));
    await expect(
      exchangeAuthorizationCode({
        config: await baseConfig({ dpop: false }),
        tokenEndpoint: "https://as.example/token",
        assertionAudience: "https://as.example",
        code: "bad-code",
        codeVerifier: "verifier-1",
        fetchImpl,
      }),
    ).rejects.toThrow(TokenExchangeError);
  });

  it("throws if the server returns 200 without access_token/token_type", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ foo: "bar" }));
    await expect(
      exchangeAuthorizationCode({
        config: await baseConfig({ dpop: false }),
        tokenEndpoint: "https://as.example/token",
        assertionAudience: "https://as.example",
        code: "code-1",
        codeVerifier: "verifier-1",
        fetchImpl,
      }),
    ).rejects.toThrow(TokenExchangeError);
  });

  it("reuses a caller-provided DPoP key pair instead of generating a new one", async () => {
    const keyPair = await generateDpopKeyPair();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ access_token: "at", token_type: "DPoP", expires_in: 3600 }));

    await exchangeAuthorizationCode({
      config: await baseConfig(),
      tokenEndpoint: "https://as.example/token",
      assertionAudience: "https://as.example",
      code: "code-1",
      codeVerifier: "verifier-1",
      dpopKeyPair: keyPair,
      fetchImpl,
    });

    const proof = fetchImpl.mock.calls[0][1].headers.DPoP as string;
    const header = JSON.parse(atob(proof.split(".")[0].replace(/-/g, "+").replace(/_/g, "/")));
    const expectedJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    expect(header.jwk.x).toBe(expectedJwk.x);
  });
});

describe("exchangeRefreshToken", () => {
  it("carries the old refresh_token forward when the server omits a new one", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ access_token: "at2", token_type: "DPoP", expires_in: 3600 }));
    const tokens = await exchangeRefreshToken({
      config: await baseConfig(),
      tokenEndpoint: "https://as.example/token",
      assertionAudience: "https://as.example",
      refreshToken: "rt-original",
      fetchImpl,
    });
    expect(tokens.refreshToken).toBe("rt-original");
  });

  it("uses the server's rotated refresh_token when provided", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ access_token: "at2", token_type: "DPoP", expires_in: 3600, refresh_token: "rt-rotated" }),
    );
    const tokens = await exchangeRefreshToken({
      config: await baseConfig(),
      tokenEndpoint: "https://as.example/token",
      assertionAudience: "https://as.example",
      refreshToken: "rt-original",
      fetchImpl,
    });
    expect(tokens.refreshToken).toBe("rt-rotated");
  });

  it("audiences the client assertion to assertionAudience, not the token endpoint (rfc7523bis)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ access_token: "at2", token_type: "DPoP", expires_in: 3600 }));
    await exchangeRefreshToken({
      config: await baseConfig(),
      tokenEndpoint: "https://as.example/token",
      assertionAudience: "https://as.example",
      refreshToken: "rt-original",
      fetchImpl,
    });
    const [, init] = fetchImpl.mock.calls[0];
    const body = new URLSearchParams(init.body as URLSearchParams);
    const payload = decodeJwtPayload(body.get("client_assertion")!);
    expect(payload.aud).toBe("https://as.example");
  });
});
