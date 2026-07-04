import { describe, expect, it, vi } from "vitest";
import { discoverOidcConfiguration, DiscoveryError } from "@oauth-spa-kit/core";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("discoverOidcConfiguration", () => {
  it("fetches the well-known discovery document", async () => {
    const doc = { issuer: "https://issuer.example", authorization_endpoint: "a", token_endpoint: "t" };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(doc));

    const result = await discoverOidcConfiguration(`https://issuer-${Math.random()}.example`, fetchImpl);
    expect(result.issuer).toBe("https://issuer.example");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toMatch(/\/\.well-known\/openid-configuration$/);
  });

  it("caches subsequent calls for the same issuer", async () => {
    const issuer = `https://issuer-cache-${Math.random()}.example`;
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ issuer, authorization_endpoint: "a", token_endpoint: "t" }));

    await discoverOidcConfiguration(issuer, fetchImpl);
    await discoverOidcConfiguration(issuer, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("throws DiscoveryError on a non-ok response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 500));
    await expect(
      discoverOidcConfiguration(`https://issuer-error-${Math.random()}.example`, fetchImpl),
    ).rejects.toThrow(DiscoveryError);
  });
});
