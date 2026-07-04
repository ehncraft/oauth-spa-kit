import { describe, expect, it } from "vitest";
import { expireCookie, parseCookies, serializeCookie } from "../src/cookies";

describe("parseCookies", () => {
  it("parses multiple cookies from the Cookie header", () => {
    const request = new Request("https://app.example", { headers: { Cookie: "a=1; b=2; c=hello%20world" } });
    expect(parseCookies(request)).toEqual({ a: "1", b: "2", c: "hello world" });
  });

  it("returns an empty object when there is no Cookie header", () => {
    const request = new Request("https://app.example");
    expect(parseCookies(request)).toEqual({});
  });
});

describe("serializeCookie", () => {
  it("always includes HttpOnly, Secure, and SameSite=Lax", () => {
    const header = serializeCookie("name", "value");
    expect(header).toMatch(/\bHttpOnly\b/);
    expect(header).toMatch(/\bSecure\b/);
    expect(header).toMatch(/SameSite=Lax/);
    expect(header).toMatch(/^name=value;/);
  });

  it("URL-encodes the value", () => {
    const header = serializeCookie("name", "a b/c");
    expect(header).toContain("name=a%20b%2Fc");
  });

  it("includes Max-Age when maxAgeSeconds is given", () => {
    expect(serializeCookie("name", "value", { maxAgeSeconds: 300 })).toContain("Max-Age=300");
  });
});

describe("expireCookie", () => {
  it("sets Max-Age=0", () => {
    expect(expireCookie("name")).toContain("Max-Age=0");
  });
});
