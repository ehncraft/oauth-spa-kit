/**
 * Generic authenticated encryption for cookie payloads (AES-256-GCM via Web
 * Crypto). Same idea as nuxt-auth-utils' sealed session cookies
 * (iron-session under the hood there), reimplemented directly against Web
 * Crypto so it has zero dependencies and runs unmodified on Node >=18,
 * Cloudflare Workers, Deno, and Vercel Edge.
 */

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveKey(password: string): Promise<CryptoKey> {
  if (password.length < 32) {
    throw new Error("Cookie sealing password must be at least 32 characters -- generate one with `openssl rand -base64 32`.");
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(password));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function sealJson(payload: unknown, password: string): Promise<string> {
  const key = await deriveKey(password);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext),
  );
  const combined = new Uint8Array(iv.length + ciphertext.length);
  combined.set(iv, 0);
  combined.set(ciphertext, iv.length);
  return base64UrlEncode(combined);
}

export async function unsealJson<T>(sealed: string, password: string): Promise<T | null> {
  try {
    const key = await deriveKey(password);
    const combined = base64UrlDecode(sealed);
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    return JSON.parse(new TextDecoder().decode(plaintext)) as T;
  } catch {
    // Tampered, expired-key-rotation, or malformed cookie -- treat as "no session", never throw.
    return null;
  }
}
