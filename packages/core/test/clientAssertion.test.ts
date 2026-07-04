import { describe, expect, it } from "vitest";
import { buildClientAssertionParams, verifyJwt, type Jwks } from "@oauth-spa-kit/core";

describe("buildClientAssertionParams", () => {
  it("builds a valid private_key_jwt assertion", async () => {
    const { publicKey, privateKey } = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"],
    );

    const params = await buildClientAssertionParams(
      "client-1",
      { method: "private_key_jwt", privateKey, keyId: "k1", alg: "ES256" },
      "https://as.example/token",
    );

    expect(params.client_assertion_type).toBe("urn:ietf:params:oauth:client-assertion-type:jwt-bearer");

    const jwk = await crypto.subtle.exportKey("jwk", publicKey);
    const jwks: Jwks = { keys: [{ ...jwk, kid: "k1" }] };
    const { payload } = await verifyJwt({
      token: params.client_assertion,
      jwks,
      expectedIssuer: "client-1", // iss === sub === client_id for private_key_jwt
      expectedAudience: "https://as.example/token",
    });
    expect(payload.sub).toBe("client-1");
    expect(payload.jti).toBeTypeOf("string");
  });

  it("defaults to a short (<=60s) assertion lifetime", async () => {
    const { privateKey } = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const params = await buildClientAssertionParams(
      "client-1",
      { method: "private_key_jwt", privateKey, alg: "ES256" },
      "https://as.example/token",
    );
    const [, encodedPayload] = params.client_assertion.split(".");
    const payload = JSON.parse(atob(encodedPayload.replace(/-/g, "+").replace(/_/g, "/")));
    expect(payload.exp - payload.iat).toBeLessThanOrEqual(60);
  });
});
