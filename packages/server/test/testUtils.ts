/** Turns a `Set-Cookie` header value into what a browser would send back as `Cookie` on the next request. */
export function toCookieHeader(...setCookieValues: string[]): string {
  return setCookieValues.map((v) => v.split(";")[0]).join("; ");
}

export function requestWithCookies(url: string, ...setCookieValues: string[]): Request {
  return new Request(url, { headers: { Cookie: toCookieHeader(...setCookieValues) } });
}
