import { describe, expect, it } from "vitest";
import { createPkceParams, generateCodeChallenge, generateRandomString } from "@oauth-spa-kit/core";

describe("generateRandomString", () => {
  it("produces distinct values across calls", () => {
    const values = new Set(Array.from({ length: 20 }, () => generateRandomString()));
    expect(values.size).toBe(20);
  });

  it("is URL-safe (no +, /, or = padding)", () => {
    const value = generateRandomString(32);
    expect(value).not.toMatch(/[+/=]/);
  });
});

describe("generateCodeChallenge", () => {
  // RFC 7636 Appendix B test vector.
  it("matches the RFC 7636 S256 test vector", async () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const challenge = await generateCodeChallenge(verifier);
    expect(challenge).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
});

describe("createPkceParams", () => {
  it("returns S256-method params whose challenge matches its own verifier", async () => {
    const params = await createPkceParams();
    expect(params.codeChallengeMethod).toBe("S256");
    await expect(generateCodeChallenge(params.codeVerifier)).resolves.toBe(params.codeChallenge);
  });

  it("generates distinct state and nonce", async () => {
    const params = await createPkceParams();
    expect(params.state).not.toBe(params.nonce);
  });
});
