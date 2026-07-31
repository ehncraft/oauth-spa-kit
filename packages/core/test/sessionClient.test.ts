import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionClient } from "@oauth-spa-kit/core";

// `login()` and `logout()` both navigate via `window.location`, which needs a
// DOM environment this package intentionally doesn't depend on for its unit
// tests (kept to plain Node -- see vitest.config.ts). Covered here:
// everything that goes through `fetch`/`BroadcastChannel`, i.e. `refresh()`
// and subscriber notification.

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

  it("unsubscribe stops further notifications", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ user: null }, 401));
    const client = createSessionClient({ fetchImpl });
    const seen: boolean[] = [];
    const unsubscribe = client.subscribe((state) => seen.push(state.loggedIn));
    unsubscribe();

    await client.refresh();
    expect(seen).toEqual([]);
  });

  it("refresh() carries the device label through from /auth/session", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ user: { sub: "u1" }, device: "Chrome on macOS" }));
    const client = createSessionClient({ fetchImpl });

    await client.refresh();
    expect(client.getState().device).toBe("Chrome on macOS");
  });
});

// Liveness polling and idle tracking only start when `window` exists (both are browser-only
// features -- these tests run under vitest's default Node environment, which has no window
// global by default, so a minimal stub (with a mocked addEventListener, since idle tracking
// registers activity listeners) is enough to opt the client under test into both branches
// without pulling in a full DOM environment).
describe("createSessionClient liveness polling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { addEventListener: vi.fn() });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("does not poll when livenessCheckIntervalMs is not set", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ user: { sub: "u1" } }));
    createSessionClient({ fetchImpl });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not poll while logged out", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ user: null }, 401));
    const client = createSessionClient({ fetchImpl, livenessCheckIntervalMs: 1000 });
    await client.refresh(); // still logged out afterwards

    await vi.advanceTimersByTimeAsync(5000);
    // Only the refresh() call itself, no liveness calls on top.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("logs the session out after two consecutive liveness failures, not one", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ user: { sub: "u1" } })) // refresh()
      .mockResolvedValue(new Response(null, { status: 401 })); // every liveness poll after
    const onSessionExpired = vi.fn();
    const client = createSessionClient({ fetchImpl, livenessCheckIntervalMs: 1000, onSessionExpired });
    await client.refresh();

    await vi.advanceTimersByTimeAsync(1000);
    expect(client.getState().loggedIn).toBe(true);
    expect(onSessionExpired).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    expect(client.getState()).toEqual({ ready: true, loggedIn: false, user: null });
    expect(onSessionExpired).toHaveBeenCalledOnce();
  });

  it("a single transient failure does not log the session out", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ user: { sub: "u1" } })) // refresh()
      .mockRejectedValueOnce(new Error("network blip")) // 1st poll
      .mockResolvedValue(new Response(null, { status: 200 })); // recovers
    const onSessionExpired = vi.fn();
    const client = createSessionClient({ fetchImpl, livenessCheckIntervalMs: 1000, onSessionExpired });
    await client.refresh();

    await vi.advanceTimersByTimeAsync(1000); // failure #1
    await vi.advanceTimersByTimeAsync(1000); // recovers, resets the counter
    await vi.advanceTimersByTimeAsync(1000); // healthy poll

    expect(client.getState().loggedIn).toBe(true);
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  it("polls the configured livenessPath", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ user: { sub: "u1" } }))
      .mockResolvedValue(new Response(null, { status: 200 }));
    const client = createSessionClient({ fetchImpl, livenessCheckIntervalMs: 1000, livenessPath: "/custom/liveness" });
    await client.refresh();

    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchImpl.mock.calls[1][0]).toBe("/custom/liveness");
  });
});

describe("createSessionClient idle timeout", () => {
  let assign: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    assign = vi.fn();
    vi.stubGlobal("window", { addEventListener: vi.fn(), location: { origin: "http://localhost", assign } });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("does not start a timer while logged out", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ user: null }, 401));
    const client = createSessionClient({ fetchImpl, idleTimeoutMs: 1000 });
    await client.refresh();

    await vi.advanceTimersByTimeAsync(10_000);
    expect(assign).not.toHaveBeenCalled();
  });

  it("logs out after idleTimeoutMs of inactivity", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ user: { sub: "u1" } }));
    const onIdleTimeout = vi.fn();
    const client = createSessionClient({ fetchImpl, idleTimeoutMs: 1000, onIdleTimeout });
    await client.refresh();

    await vi.advanceTimersByTimeAsync(1000);
    expect(onIdleTimeout).toHaveBeenCalledOnce();
    expect(assign).toHaveBeenCalledOnce();
    expect(assign.mock.calls[0][0]).toContain("/auth/logout");
  });

  it("activity resets the timer instead of letting it lapse", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ user: { sub: "u1" } }));
    const client = createSessionClient({ fetchImpl, idleTimeoutMs: 1000 });
    await client.refresh();
    const windowStub = window as unknown as { addEventListener: ReturnType<typeof vi.fn> };
    const [, onActivity] = windowStub.addEventListener.mock.calls[0] as [string, () => void];

    await vi.advanceTimersByTimeAsync(700);
    onActivity(); // resets the 1000ms window with 700ms already elapsed
    await vi.advanceTimersByTimeAsync(700);
    expect(assign).not.toHaveBeenCalled(); // would have fired at 1000ms without the reset

    await vi.advanceTimersByTimeAsync(300);
    expect(assign).toHaveBeenCalledOnce();
  });

  it("idleTimeoutMs: 0 disables idle tracking entirely", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ user: { sub: "u1" } }));
    const client = createSessionClient({ fetchImpl, idleTimeoutMs: 0 });
    await client.refresh();

    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(assign).not.toHaveBeenCalled();
    expect((window as unknown as { addEventListener: ReturnType<typeof vi.fn> }).addEventListener).not.toHaveBeenCalled();
  });
});
