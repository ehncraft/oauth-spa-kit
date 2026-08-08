import { describe, expect, it } from "vitest";
import {
  clearSessionHeader,
  deleteStoredSession,
  readSession,
  writeSessionHeader,
  type SessionStore,
  type StoredSession,
} from "../src/session";
import { requestWithCookies } from "./testUtils";

const config = { password: "a".repeat(32) };
const session: StoredSession = {
  tokens: { accessToken: "at", tokenType: "DPoP", expiresAt: Date.now() + 60_000 },
  user: { sub: "u1" },
};

/** Minimal in-memory `SessionStore` for tests -- a real consumer would back this with Redis/KV/etc. */
function createMemoryStore(): SessionStore & { size: () => number } {
  const entries = new Map<string, string>();
  return {
    async get(sessionId) {
      return entries.get(sessionId) ?? null;
    },
    async set(sessionId, sealedPayload) {
      entries.set(sessionId, sealedPayload);
    },
    async delete(sessionId) {
      entries.delete(sessionId);
    },
    size: () => entries.size,
  };
}

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

describe("store-backed sessions", () => {
  it("round-trips through the store, cookie carries only an opaque id", async () => {
    const store = createMemoryStore();
    const storeConfig = { ...config, store };

    const setCookie = await writeSessionHeader(session, storeConfig);
    // The cookie value itself must not be (or contain) the sealed session -- just an id.
    const cookieValue = setCookie.split(";")[0]!.split("=")[1]!;
    expect(cookieValue.length).toBeLessThan(60);
    expect(store.size()).toBe(1);

    const request = requestWithCookies("https://app.example", setCookie);
    expect(await readSession(request, storeConfig)).toEqual(session);
  });

  it("returns null when the store has no entry for the cookie's id (evicted/expired)", async () => {
    const store = createMemoryStore();
    const storeConfig = { ...config, store };

    const setCookie = await writeSessionHeader(session, storeConfig);
    await store.delete(setCookie.split(";")[0]!.split("=")[1]!);

    const request = requestWithCookies("https://app.example", setCookie);
    expect(await readSession(request, storeConfig)).toBeNull();
  });

  it("does not fall back to treating the cookie value itself as a sealed session", async () => {
    // Without a store, the cookie *is* the sealed session -- with one configured, reading that
    // same raw cookie value as if it were a store id must not accidentally decrypt anything.
    const store = createMemoryStore();
    const setCookie = await writeSessionHeader(session, config);
    const request = requestWithCookies("https://app.example", setCookie);
    expect(await readSession(request, { ...config, store })).toBeNull();
  });

  it("rotates the store entry on re-write when given the previous request, not just add a new one", async () => {
    const store = createMemoryStore();
    const storeConfig = { ...config, store };

    const firstSetCookie = await writeSessionHeader(session, storeConfig);
    const firstRequest = requestWithCookies("https://app.example", firstSetCookie);
    expect(store.size()).toBe(1);

    const refreshed: StoredSession = { ...session, tokens: { ...session.tokens, accessToken: "at2" } };
    const secondSetCookie = await writeSessionHeader(refreshed, storeConfig, firstRequest);
    expect(store.size()).toBe(1);
    expect(secondSetCookie).not.toBe(firstSetCookie);

    // The old cookie/id no longer resolves to anything -- it was deleted, not just replaced by name.
    expect(await readSession(firstRequest, storeConfig)).toBeNull();

    const secondRequest = requestWithCookies("https://app.example", secondSetCookie);
    expect(await readSession(secondRequest, storeConfig)).toEqual(refreshed);
  });

  it("re-writing without a previousRequest leaves the old entry orphaned (caller's choice, e.g. brand-new login)", async () => {
    const store = createMemoryStore();
    const storeConfig = { ...config, store };

    await writeSessionHeader(session, storeConfig);
    await writeSessionHeader(session, storeConfig);
    expect(store.size()).toBe(2);
  });
});

describe("deleteStoredSession", () => {
  it("removes the store entry for the request's session cookie", async () => {
    const store = createMemoryStore();
    const storeConfig = { ...config, store };

    const setCookie = await writeSessionHeader(session, storeConfig);
    const request = requestWithCookies("https://app.example", setCookie);
    expect(store.size()).toBe(1);

    await deleteStoredSession(request, storeConfig);
    expect(store.size()).toBe(0);
    expect(await readSession(request, storeConfig)).toBeNull();
  });

  it("is a no-op when no store is configured", async () => {
    const setCookie = await writeSessionHeader(session, config);
    const request = requestWithCookies("https://app.example", setCookie);
    await expect(deleteStoredSession(request, config)).resolves.toBeUndefined();
  });

  it("is a no-op when the request has no session cookie", async () => {
    const store = createMemoryStore();
    const request = new Request("https://app.example");
    await expect(deleteStoredSession(request, { ...config, store })).resolves.toBeUndefined();
  });

  it("is a no-op when the store has already evicted the entry", async () => {
    const store = createMemoryStore();
    const storeConfig = { ...config, store };
    const setCookie = await writeSessionHeader(session, storeConfig);
    const request = requestWithCookies("https://app.example", setCookie);

    await deleteStoredSession(request, storeConfig);
    await expect(deleteStoredSession(request, storeConfig)).resolves.toBeUndefined();
  });
});
