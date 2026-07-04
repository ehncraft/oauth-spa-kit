import { describe, expect, it, vi } from "vitest";
import { fetchJwks, DiscoveryError } from "@oauth-spa-kit/core";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("fetchJwks", () => {
  it("fetches and caches the JWKS per URI", async () => {
    const jwksUri = `https://issuer-${Math.random()}.example/jwks.json`;
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ keys: [{ kty: "EC", kid: "k1" }] }));

    const first = await fetchJwks(jwksUri, fetchImpl);
    const second = await fetchJwks(jwksUri, fetchImpl);

    expect(first.keys[0].kid).toBe("k1");
    expect(second).toBe(first); // same cached object
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("throws DiscoveryError on a non-ok response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 404));
    await expect(fetchJwks(`https://issuer-404-${Math.random()}.example/jwks.json`, fetchImpl)).rejects.toThrow(DiscoveryError);
  });
});
