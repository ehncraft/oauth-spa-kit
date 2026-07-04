import { describe, expect, it } from "vitest";
import { JwtVerificationError, signJwt, verifyJwt, type Jwks } from "@oauth-spa-kit/core";

async function generateEs256KeyPair() {
  return crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
}

async function generatePs256KeyPair() {
  return crypto.subtle.generateKey(
    { name: "RSA-PSS", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
}

async function jwksFor(publicKey: CryptoKey, kid: string): Promise<Jwks> {
  const jwk = await crypto.subtle.exportKey("jwk", publicKey);
  return { keys: [{ ...jwk, kid }] };
}

describe("signJwt / verifyJwt", () => {
  it("round-trips an ES256-signed token", async () => {
    const { publicKey, privateKey } = await generateEs256KeyPair();
    const token = await signJwt({
      header: { kid: "k1" },
      payload: { iss: "https://issuer.example", aud: "client-1", sub: "user-1", exp: Math.floor(Date.now() / 1000) + 60 },
      privateKey,
      alg: "ES256",
    });

    const { payload } = await verifyJwt({
      token,
      jwks: await jwksFor(publicKey, "k1"),
      expectedIssuer: "https://issuer.example",
      expectedAudience: "client-1",
    });
    expect(payload.sub).toBe("user-1");
  });

  it("round-trips a PS256-signed token", async () => {
    const { publicKey, privateKey } = await generatePs256KeyPair();
    const token = await signJwt({
      header: { kid: "k2" },
      payload: { iss: "https://issuer.example", aud: "client-1", exp: Math.floor(Date.now() / 1000) + 60 },
      privateKey,
      alg: "PS256",
    });

    const { payload } = await verifyJwt({
      token,
      jwks: await jwksFor(publicKey, "k2"),
      expectedIssuer: "https://issuer.example",
      expectedAudience: "client-1",
    });
    expect(payload.iss).toBe("https://issuer.example");
  });

  it("rejects a tampered signature", async () => {
    const { publicKey, privateKey } = await generateEs256KeyPair();
    const token = await signJwt({
      header: { kid: "k1" },
      payload: { iss: "https://issuer.example", aud: "client-1", exp: Math.floor(Date.now() / 1000) + 60 },
      privateKey,
      alg: "ES256",
    });
    const [h, p, s] = token.split(".");
    const tampered = `${h}.${p}.${s.slice(0, -2)}${s.at(-2) === "A" ? "B" : "A"}${s.at(-1)}`;

    await expect(
      verifyJwt({
        token: tampered,
        jwks: await jwksFor(publicKey, "k1"),
        expectedIssuer: "https://issuer.example",
        expectedAudience: "client-1",
      }),
    ).rejects.toThrow(JwtVerificationError);
  });

  it("rejects an expired token even against a valid signature", async () => {
    const { publicKey, privateKey } = await generateEs256KeyPair();
    const token = await signJwt({
      header: { kid: "k1" },
      payload: { iss: "https://issuer.example", aud: "client-1", exp: Math.floor(Date.now() / 1000) - 3600 },
      privateKey,
      alg: "ES256",
    });

    await expect(
      verifyJwt({
        token,
        jwks: await jwksFor(publicKey, "k1"),
        expectedIssuer: "https://issuer.example",
        expectedAudience: "client-1",
        clockToleranceSeconds: 0,
      }),
    ).rejects.toThrow(/expired/);
  });

  it("rejects a wrong issuer, audience, or nonce", async () => {
    const { publicKey, privateKey } = await generateEs256KeyPair();
    const jwks = await jwksFor(publicKey, "k1");
    const makeToken = (payload: Record<string, unknown>) =>
      signJwt({ header: { kid: "k1" }, payload, privateKey, alg: "ES256" });

    const wrongIssuer = await makeToken({ iss: "https://evil.example", aud: "client-1", exp: Math.floor(Date.now() / 1000) + 60 });
    await expect(
      verifyJwt({ token: wrongIssuer, jwks, expectedIssuer: "https://issuer.example", expectedAudience: "client-1" }),
    ).rejects.toThrow(/iss/);

    const wrongAudience = await makeToken({ iss: "https://issuer.example", aud: "someone-else", exp: Math.floor(Date.now() / 1000) + 60 });
    await expect(
      verifyJwt({ token: wrongAudience, jwks, expectedIssuer: "https://issuer.example", expectedAudience: "client-1" }),
    ).rejects.toThrow(/aud/);

    const wrongNonce = await makeToken({ iss: "https://issuer.example", aud: "client-1", nonce: "n1", exp: Math.floor(Date.now() / 1000) + 60 });
    await expect(
      verifyJwt({ token: wrongNonce, jwks, expectedIssuer: "https://issuer.example", expectedAudience: "client-1", expectedNonce: "n2" }),
    ).rejects.toThrow(/nonce/);
  });

  it("rejects unsupported algorithms (e.g. RS256, HS256)", async () => {
    const { publicKey } = await generateEs256KeyPair();
    // Hand-construct a header claiming RS256 -- verifyJwt must reject before ever touching the signature.
    const header = { alg: "RS256", typ: "JWT", kid: "k1" };
    const payload = { iss: "https://issuer.example", aud: "client-1" };
    const encode = (v: unknown) => btoa(JSON.stringify(v)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const fakeToken = `${encode(header)}.${encode(payload)}.sig`;

    await expect(
      verifyJwt({
        token: fakeToken,
        jwks: await jwksFor(publicKey, "k1"),
        expectedIssuer: "https://issuer.example",
        expectedAudience: "client-1",
      }),
    ).rejects.toThrow(/RS256/);
  });
});
