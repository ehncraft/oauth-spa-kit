import { describe, expect, it } from "vitest";
import { parseUserAgent } from "@oauth-spa-kit/core";

const CHROME_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const SAFARI_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
const EDGE_WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0";
const FIREFOX_LINUX = "Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0";
const CHROME_ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
const SAFARI_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const CHROME_IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0.0.0 Mobile/15E148 Safari/604.1";
const OPERA_WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 OPR/110.0.0.0";

describe("parseUserAgent", () => {
  it("returns undefined for a missing User-Agent", () => {
    expect(parseUserAgent(undefined)).toBeUndefined();
    expect(parseUserAgent(null)).toBeUndefined();
    expect(parseUserAgent("")).toBeUndefined();
  });

  it("labels Chrome on macOS", () => {
    expect(parseUserAgent(CHROME_MAC)).toBe("Chrome on macOS");
  });

  it("labels Safari on macOS, not Chrome (both share the Safari/ token)", () => {
    expect(parseUserAgent(SAFARI_MAC)).toBe("Safari on macOS");
  });

  it("labels Edge on Windows, not Chrome (Edge UA also contains Chrome/)", () => {
    expect(parseUserAgent(EDGE_WINDOWS)).toBe("Edge on Windows");
  });

  it("labels Opera on Windows, not Chrome (Opera UA also contains Chrome/)", () => {
    expect(parseUserAgent(OPERA_WINDOWS)).toBe("Opera on Windows");
  });

  it("labels Firefox on Linux", () => {
    expect(parseUserAgent(FIREFOX_LINUX)).toBe("Firefox on Linux");
  });

  it("labels Chrome on Android", () => {
    expect(parseUserAgent(CHROME_ANDROID)).toBe("Chrome on Android");
  });

  it("labels Safari on iPhone", () => {
    expect(parseUserAgent(SAFARI_IPHONE)).toBe("Safari on iPhone");
  });

  it("labels Chrome on iPhone, not Safari (CriOS UA also contains Safari/)", () => {
    expect(parseUserAgent(CHROME_IOS)).toBe("Chrome on iPhone");
  });

  it("falls back to Unknown browser/OS for an unrecognized string", () => {
    expect(parseUserAgent("curl/8.4.0")).toBe("Unknown browser on Unknown OS");
  });
});
