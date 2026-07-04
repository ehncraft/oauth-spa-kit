import { describe, expect, it } from "vitest";
import { clearSessionHeader, readSession, writeSessionHeader, type StoredSession } from "../src/session";
import { requestWithCookies } from "./testUtils";

const config = { password: "a".repeat(32) };
const session: StoredSession = {
  tokens: { accessToken: "at", tokenType: "DPoP", expiresAt: Date.now() + 60_000 },
  user: { sub: "u1" },
};

describe("readSession / writeSessionHeader", () => {
  it("round-trips a session through Set-Cookie -> Cookie", async () => {
    const setCookie = await writeSessionHeader(session, config);
    const request = requestWithCookies("https://app.example", setCookie);
    const result = await readSession(request, config);
    expect(result).toEqual(session);
  });

  it("returns null when there is no session cookie", async () => {
    const request = new Request("https://app.example");
    expect(await readSession(request, config)).toBeNull();
  });

  it("respects a custom cookie name", async () => {
    const customConfig = { ...config, cookieName: "__custom" };
    const setCookie = await writeSessionHeader(session, customConfig);
    expect(setCookie).toMatch(/^__custom=/);

    const request = requestWithCookies("https://app.example", setCookie);
    expect(await readSession(request, customConfig)).toEqual(session);
    // The default cookie name should find nothing.
    expect(await readSession(request, config)).toBeNull();
  });
});

describe("clearSessionHeader", () => {
  it("expires the session cookie", () => {
    expect(clearSessionHeader(config)).toContain("Max-Age=0");
  });
});
