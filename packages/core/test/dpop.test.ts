import { describe, expect, it } from "vitest";
import {
  computeJwkThumbprint,
  createDpopProof,
  exportDpopKeyPair,
  generateDpopKeyPair,
  importDpopKeyPair,
} from "@oauth-spa-kit/core";

function decodeJwtPart(part: string): Record<string, unknown> {
  const padded = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
  return JSON.parse(atob(padded));
}

describe("createDpopProof", () => {
  it("produces a dpop+jwt with the expected header and payload shape", async () => {
    const keyPair = await generateDpopKeyPair();
    const proof = await createDpopProof({ keyPair, htm: "POST", htu: "https://as.example/token" });
    const [encodedHeader, encodedPayload, encodedSignature] = proof.split(".");

    const header = decodeJwtPart(encodedHeader);
    expect(header.typ).toBe("dpop+jwt");
    expect(header.alg).toBe("ES256");
    expect(header.jwk).toMatchObject({ kty: "EC", crv: "P-256" });
    expect(Object.keys(header.jwk as object).sort()).toEqual(["crv", "kty", "x", "y"]);

    const payload = decodeJwtPart(encodedPayload);
    expect(payload.htm).toBe("POST");
    expect(payload.htu).toBe("https://as.example/token");
    expect(typeof payload.iat).toBe("number");
    expect(typeof payload.jti).toBe("string");

    expect(encodedSignature.length).toBeGreaterThan(0);
  });

  it("signs with a key that verifies against its own embedded jwk", async () => {
    const keyPair = await generateDpopKeyPair();
    const proof = await createDpopProof({ keyPair, htm: "GET", htu: "https://as.example/resource" });
    const [encodedHeader, encodedPayload, encodedSignature] = proof.split(".");
    const header = decodeJwtPart(encodedHeader);

    const publicKey = await crypto.subtle.importKey(
      "jwk",
      header.jwk as JsonWebKey,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const sigBytes = Uint8Array.from(
      atob(encodedSignature.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(encodedSignature.length / 4) * 4, "=")),
      (c) => c.charCodeAt(0),
    );
    const valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      sigBytes,
      new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
    );
    expect(valid).toBe(true);
  });

  it("includes ath (access token hash) only when an access token is passed", async () => {
    const keyPair = await generateDpopKeyPair();
    const withToken = await createDpopProof({ keyPair, htm: "GET", htu: "https://as.example/x", accessToken: "abc" });
    const withoutToken = await createDpopProof({ keyPair, htm: "GET", htu: "https://as.example/x" });

    expect(decodeJwtPart(withToken.split(".")[1]).ath).toBeTypeOf("string");
    expect(decodeJwtPart(withoutToken.split(".")[1]).ath).toBeUndefined();
  });

  it("includes the given nonce", async () => {
    const keyPair = await generateDpopKeyPair();
    const proof = await createDpopProof({ keyPair, htm: "POST", htu: "https://as.example/token", nonce: "srv-nonce" });
    expect(decodeJwtPart(proof.split(".")[1]).nonce).toBe("srv-nonce");
  });
});

describe("export/importDpopKeyPair", () => {
  it("round-trips a key pair that still produces verifiable proofs", async () => {
    const original = await generateDpopKeyPair();
    const serialized = await exportDpopKeyPair(original);
    const imported = await importDpopKeyPair(serialized);

    const originalThumbprint = await computeJwkThumbprint(original.publicKey);
    const importedThumbprint = await computeJwkThumbprint(imported.publicKey);
    expect(importedThumbprint).toBe(originalThumbprint);

    const proof = await createDpopProof({ keyPair: imported, htm: "POST", htu: "https://as.example/token" });
    expect(proof.split(".")).toHaveLength(3);
  });
});

describe("computeJwkThumbprint", () => {
  it("is deterministic for the same key and differs across keys", async () => {
    const keyPair = await generateDpopKeyPair();
    const first = await computeJwkThumbprint(keyPair.publicKey);
    const second = await computeJwkThumbprint(keyPair.publicKey);
    expect(first).toBe(second);

    const other = await generateDpopKeyPair();
    const otherThumbprint = await computeJwkThumbprint(other.publicKey);
    expect(otherThumbprint).not.toBe(first);
  });
});
