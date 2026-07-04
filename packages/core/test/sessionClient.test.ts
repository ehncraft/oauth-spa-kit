import { describe, expect, it, vi } from "vitest";
import { createSessionClient } from "@oauth-spa-kit/core";

// `login()` navigates via `window.location`, which needs a DOM environment
// this package intentionally doesn't depend on for its unit tests (kept to
// plain Node -- see vitest.config.ts). Covered here: everything that goes
// through `fetch`/`BroadcastChannel`, i.e. `refresh()`, `logout()`, and
// subscriber notification.

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("createSessionClient", () => {
  it("starts unready with no user", () => {
    const client = createSessionClient({ fetchImpl: vi.fn() });
    expect(client.getState()).toEqual({ ready: false, loggedIn: false, user: null });
  });

  it("refresh() populates state from a successful /auth/session response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ user: { sub: "u1" } }));
    const client = createSessionClient({ fetchImpl });

    await client.refresh();
    expect(client.getState()).toEqual({ ready: true, loggedIn: true, user: { sub: "u1" } });
    expect(fetchImpl.mock.calls[0][0]).toBe("/auth/session");
  });

  it("refresh() treats a 401 as logged-out, not an error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ user: null }, 401));
    const client = createSessionClient({ fetchImpl });

    await client.refresh();
    expect(client.getState()).toEqual({ ready: true, loggedIn: false, user: null });
  });

  it("refresh() treats a network failure as logged-out rather than throwing", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));
    const client = createSessionClient({ fetchImpl });

    await expect(client.refresh()).resolves.toBeUndefined();
    expect(client.getState()).toEqual({ ready: true, loggedIn: false, user: null });
  });

  it("notifies subscribers on every state change", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ user: { sub: "u1" } }));
    const client = createSessionClient({ fetchImpl });
    const seen: boolean[] = [];
    client.subscribe((state) => seen.push(state.loggedIn));

    await client.refresh();
    expect(seen).toEqual([true]);
  });

  it("logout() clears state and POSTs to /auth/logout", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ user: { sub: "u1" } }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const client = createSessionClient({ fetchImpl });

    await client.refresh();
    expect(client.getState().loggedIn).toBe(true);

    await client.logout();
    expect(client.getState()).toEqual({ ready: true, loggedIn: false, user: null });
    expect(fetchImpl.mock.calls[1][0]).toBe("/auth/logout");
    expect(fetchImpl.mock.calls[1][1]).toMatchObject({ method: "POST" });
  });

  it("unsubscribe stops further notifications", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ user: null }, 401));
    const client = createSessionClient({ fetchImpl });
    const seen: boolean[] = [];
    const unsubscribe = client.subscribe((state) => seen.push(state.loggedIn));
    unsubscribe();

    await client.refresh();
    expect(seen).toEqual([]);
  });
});
