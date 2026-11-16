import { describe, expect, it, vi } from "vitest";
import {
  AuthzenError,
  evaluateAccess,
  evaluateAccessBatch,
  resolveOwnSubject,
  searchActions,
  searchResources,
  searchSubjects,
} from "../src/authzen";
import type { OAuthHandlersConfig } from "../src/handlers";
import { writeSessionHeader } from "../src/session";
import { requestWithCookies } from "./testUtils";

const config: OAuthHandlersConfig = {
  oauth: {} as OAuthHandlersConfig["oauth"],
  session: { password: "a".repeat(32) },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function sessionCookie() {
  return writeSessionHeader(
    { tokens: { accessToken: "at-1", tokenType: "DPoP", expiresAt: Date.now() + 60_000 }, user: { sub: "u1" } },
    config.session,
  );
}

describe("evaluateAccess", () => {
  it("forwards the session's Authorization header to the PDP and returns its decision", async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe("https://pdp.example/access/v1/evaluation");
      expect((init!.headers as Record<string, string>).authorization).toBe("DPoP at-1");
      expect(JSON.parse(init!.body as string)).toEqual({
        subject: { type: "user", id: "u1" },
        resource: { type: "document", id: "doc-1" },
        action: { name: "can_read" },
      });
      return jsonResponse({ decision: true });
    });

    const cookie = await sessionCookie();
    const result = await evaluateAccess(
      requestWithCookies("https://app.example/api/whatever", cookie),
      config,
      { pdpUrl: "https://pdp.example", fetchImpl },
      {
        subject: { type: "user", id: "u1" },
        resource: { type: "document", id: "doc-1" },
        action: { name: "can_read" },
      },
    );

    expect(result?.result).toEqual({ decision: true });
    expect(result?.setCookie).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("returns null with no session, without calling the PDP", async () => {
    const fetchImpl = vi.fn();
    const result = await evaluateAccess(
      new Request("https://app.example/api/whatever"),
      config,
      { pdpUrl: "https://pdp.example", fetchImpl },
      { subject: { type: "user", id: "u1" }, action: { name: "can_read" } },
    );
    expect(result).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("strips a trailing slash from pdpUrl before joining the path", async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      expect(String(url)).toBe("https://pdp.example/access/v1/evaluation");
      return jsonResponse({ decision: false });
    });

    await evaluateAccess(
      requestWithCookies("https://app.example/api/whatever", await sessionCookie()),
      config,
      { pdpUrl: "https://pdp.example/", fetchImpl },
      { subject: { type: "user", id: "u1" }, action: { name: "can_read" } },
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("surfaces a non-2xx PDP response as an AuthzenError", async () => {
    const fetchImpl = vi.fn(async () => new Response("forbidden by policy", { status: 403 }));

    await expect(
      evaluateAccess(
        requestWithCookies("https://app.example/api/whatever", await sessionCookie()),
        config,
        { pdpUrl: "https://pdp.example", fetchImpl },
        { subject: { type: "user", id: "u1" }, action: { name: "can_read" } },
      ),
    ).rejects.toThrow(AuthzenError);
  });
});

describe("evaluateAccessBatch", () => {
  it("posts to /access/v1/evaluations and returns the PDP's evaluations array", async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      expect(String(url)).toBe("https://pdp.example/access/v1/evaluations");
      return jsonResponse({ evaluations: [{ decision: true }, { decision: false }] });
    });

    const result = await evaluateAccessBatch(
      requestWithCookies("https://app.example/api/whatever", await sessionCookie()),
      config,
      { pdpUrl: "https://pdp.example", fetchImpl },
      {
        subject: { type: "user", id: "u1" },
        evaluations: [{ action: { name: "can_read" } }, { action: { name: "can_write" } }],
      },
    );

    expect(result?.result.evaluations).toEqual([{ decision: true }, { decision: false }]);
  });
});

describe("search APIs", () => {
  it("searchResources posts to /access/v1/search/resource", async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      expect(String(url)).toBe("https://pdp.example/access/v1/search/resource");
      return jsonResponse({ results: [{ type: "document", id: "doc-1" }] });
    });

    const result = await searchResources(
      requestWithCookies("https://app.example/api/whatever", await sessionCookie()),
      config,
      { pdpUrl: "https://pdp.example", fetchImpl },
      { subject: { type: "user", id: "u1" }, action: { name: "can_read" }, resource: { type: "document" } },
    );
    expect(result?.result.results).toEqual([{ type: "document", id: "doc-1" }]);
  });

  it("searchSubjects posts to /access/v1/search/subject", async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      expect(String(url)).toBe("https://pdp.example/access/v1/search/subject");
      return jsonResponse({ results: [{ type: "user", id: "u1" }] });
    });

    const result = await searchSubjects(
      requestWithCookies("https://app.example/api/whatever", await sessionCookie()),
      config,
      { pdpUrl: "https://pdp.example", fetchImpl },
      { resource: { type: "document", id: "doc-1" }, action: { name: "can_read" } },
    );
    expect(result?.result.results).toEqual([{ type: "user", id: "u1" }]);
  });

  it("searchActions posts to /access/v1/search/action", async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      expect(String(url)).toBe("https://pdp.example/access/v1/search/action");
      return jsonResponse({ results: [{ name: "can_read" }] });
    });

    const result = await searchActions(
      requestWithCookies("https://app.example/api/whatever", await sessionCookie()),
      config,
      { pdpUrl: "https://pdp.example", fetchImpl },
      { subject: { type: "user", id: "u1" }, resource: { type: "document", id: "doc-1" } },
    );
    expect(result?.result.results).toEqual([{ name: "can_read" }]);
  });
});

describe("resolveOwnSubject", () => {
  it("calls the resolver endpoint with the session's Authorization header and maps membershipId", async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe("https://pdp.example/v1/me/access");
      expect((init!.headers as Record<string, string>).authorization).toBe("DPoP at-1");
      return jsonResponse({ membershipId: "m-1", roles: [], permissions: [] });
    });

    const result = await resolveOwnSubject(
      requestWithCookies("https://app.example/api/whatever", await sessionCookie()),
      config,
      { endpoint: "https://pdp.example/v1/me/access", fetchImpl },
    );

    expect(result?.result).toEqual({ type: "membership", id: "m-1" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("returns null with no session, without calling the resolver endpoint", async () => {
    const fetchImpl = vi.fn();
    const result = await resolveOwnSubject(
      new Request("https://app.example/api/whatever"),
      config,
      { endpoint: "https://pdp.example/v1/me/access", fetchImpl },
    );
    expect(result).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("honors a custom idField and subjectType", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ sub: "u-42" }));

    const result = await resolveOwnSubject(
      requestWithCookies("https://app.example/api/whatever", await sessionCookie()),
      config,
      { endpoint: "https://pdp.example/v1/me/access", idField: "sub", subjectType: "user", fetchImpl },
    );

    expect(result?.result).toEqual({ type: "user", id: "u-42" });
  });

  it("throws AuthzenError when the response is missing the id field", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ roles: [] }));

    await expect(
      resolveOwnSubject(
        requestWithCookies("https://app.example/api/whatever", await sessionCookie()),
        config,
        { endpoint: "https://pdp.example/v1/me/access", fetchImpl },
      ),
    ).rejects.toThrow(AuthzenError);
  });

  it("surfaces a non-2xx resolver response as an AuthzenError", async () => {
    const fetchImpl = vi.fn(async () => new Response("unauthorized", { status: 401 }));

    await expect(
      resolveOwnSubject(
        requestWithCookies("https://app.example/api/whatever", await sessionCookie()),
        config,
        { endpoint: "https://pdp.example/v1/me/access", fetchImpl },
      ),
    ).rejects.toThrow(AuthzenError);
  });
});
