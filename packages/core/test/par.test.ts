import { describe, expect, it, vi } from "vitest";
import { OAuthError, pushAuthorizationRequest } from "@oauth-spa-kit/core";

async function testClientAuth() {
  const { privateKey } = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  return { method: "private_key_jwt" as const, privateKey, alg: "ES256" as const };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("pushAuthorizationRequest", () => {
  it("POSTs client_id, params, and a client assertion, returning the request_uri", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ request_uri: "urn:ietf:params:oauth:request_uri:abc", expires_in: 60 }));

    const result = await pushAuthorizationRequest({
      parEndpoint: "https://as.example/par",
      clientId: "client-1",
      clientAuthentication: await testClientAuth(),
      assertionAudience: "https://as.example/par",
      params: { response_type: "code", state: "s1", code_challenge: "cc", code_challenge_method: "S256" },
      fetchImpl,
    });

    expect(result.request_uri).toBe("urn:ietf:params:oauth:request_uri:abc");
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://as.example/par");
    const body = new URLSearchParams(init.body as URLSearchParams);
    expect(body.get("client_id")).toBe("client-1");
    expect(body.get("state")).toBe("s1");
    expect(body.get("client_assertion_type")).toBe("urn:ietf:params:oauth:client-assertion-type:jwt-bearer");
    expect(body.get("client_assertion")).toBeTruthy();
  });

  it("throws OAuthError on a non-ok response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: "invalid_request", error_description: "bad" }, 400));

    await expect(
      pushAuthorizationRequest({
        parEndpoint: "https://as.example/par",
        clientId: "client-1",
        clientAuthentication: await testClientAuth(),
        assertionAudience: "https://as.example/par",
        params: {},
        fetchImpl,
      }),
    ).rejects.toThrow(OAuthError);
  });
});
