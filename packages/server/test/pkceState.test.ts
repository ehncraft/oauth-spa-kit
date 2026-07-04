import { describe, expect, it } from "vitest";
import { generateDpopKeyPair, exportDpopKeyPair } from "@oauth-spa-kit/core";
import { clearPkceStateHeader, readPkceState, writePkceStateHeader, type PkceState } from "../src/pkceState";
import { requestWithCookies } from "./testUtils";

const password = "a".repeat(32);

describe("readPkceState / writePkceStateHeader", () => {
  it("round-trips PKCE state including a serialized DPoP key pair", async () => {
    const dpopKeyPair = await exportDpopKeyPair(await generateDpopKeyPair());
    const pkce: PkceState = {
      codeVerifier: "verifier-1",
      state: "state-1",
      nonce: "nonce-1",
      returnTo: "/dashboard",
      dpopKeyPair,
    };

    const setCookie = await writePkceStateHeader(pkce, password);
    const request = requestWithCookies("https://app.example", setCookie);
    expect(await readPkceState(request, password)).toEqual(pkce);
  });

  it("returns null when there is no PKCE cookie", async () => {
    expect(await readPkceState(new Request("https://app.example"), password)).toBeNull();
  });

  it("scopes the cookie to a 5 minute Max-Age", async () => {
    const setCookie = await writePkceStateHeader(
      { codeVerifier: "v", state: "s", nonce: "n", returnTo: "/" },
      password,
    );
    expect(setCookie).toContain("Max-Age=300");
  });
});

describe("clearPkceStateHeader", () => {
  it("expires the PKCE cookie", () => {
    expect(clearPkceStateHeader()).toContain("Max-Age=0");
  });
});
