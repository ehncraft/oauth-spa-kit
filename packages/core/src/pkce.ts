/**
 * PKCE (RFC 7636) and nonce/state generation.
 *
 * Uses only Web Crypto (`globalThis.crypto`), so this file runs unmodified in
 * browsers, Node >=18, and edge runtimes (Workers/Deno/Vercel Edge) -- no
 * Node-only `crypto` module import. OAuth 2.1 makes PKCE mandatory for all
 * authorization-code clients, public or confidential, so this always runs,
 * never treated as optional.
 */

import { base64UrlEncode } from "./base64url";

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

/** Cryptographically random, URL-safe string for `state`, `nonce`, or a PKCE code_verifier. */
export function generateRandomString(length = 32): string {
  return base64UrlEncode(randomBytes(length));
}

export async function generateCodeChallenge(codeVerifier: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(codeVerifier),
  );
  return base64UrlEncode(new Uint8Array(digest));
}

export interface PkceParams {
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  state: string;
  nonce: string;
}

export async function createPkceParams(): Promise<PkceParams> {
  const codeVerifier = generateRandomString(32);
  return {
    codeVerifier,
    codeChallenge: await generateCodeChallenge(codeVerifier),
    codeChallengeMethod: "S256",
    state: generateRandomString(16),
    nonce: generateRandomString(16),
  };
}
