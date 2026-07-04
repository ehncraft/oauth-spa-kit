export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Return type is deliberately the concrete `Uint8Array<ArrayBuffer>`, not
 * the bare `Uint8Array` (which TS's dom lib now type-parameterizes over
 * `ArrayBufferLike`, including `SharedArrayBuffer`) -- Web Crypto's
 * `sign`/`verify`/`decrypt` require an actual `ArrayBuffer`-backed view,
 * and a wider annotation here would silently erase that at every call site.
 */
export function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function base64UrlEncodeJson(value: unknown): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)));
}

export function base64UrlDecodeJson<T>(value: string): T {
  return JSON.parse(new TextDecoder().decode(base64UrlDecode(value))) as T;
}
