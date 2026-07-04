import { generateRandomString } from "./pkce";

/**
 * DPoP (RFC 9449) -- sender-constrained tokens. Optional but recommended:
 * without it, a leaked access/refresh token (XSS, log leakage, a
 * misconfigured proxy) is a bearer credential anyone can replay. With DPoP,
 * every token request/use is bound to a private key that never leaves this
 * process and is generated non-extractable, so it can't be exfiltrated even
 * by a full JS-execution XSS.
 *
 * This mirrors the server-side verification already done by
 * apisix/custom-plugins/apisix/plugins/dpop-verify.lua in this workspace's
 * rd-infra-lab gateway -- same RFC, opposite end of the connection.
 */

export interface DpopKeyPair {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
}

export async function generateDpopKeyPair(): Promise<DpopKeyPair> {
  const { publicKey, privateKey } = await globalThis.crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    /* extractable */ false,
    ["sign", "verify"],
  );
  return { publicKey, privateKey };
}

function base64UrlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const b of arr) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function publicJwk(publicKey: CryptoKey): Promise<JsonWebKey> {
  const jwk = await globalThis.crypto.subtle.exportKey("jwk", publicKey);
  // Only the fields the RFC actually requires in the `jwk` header go out.
  return { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
}

export interface CreateDpopProofArgs {
  keyPair: DpopKeyPair;
  htm: string; // HTTP method
  htu: string; // HTTP URI, without query/fragment
  /** Access token being presented alongside this proof (resource requests only, not the initial token request). */
  accessToken?: string;
  /** `DPoP-Nonce` value the server previously returned, if any. */
  nonce?: string;
}

export async function createDpopProof({
  keyPair,
  htm,
  htu,
  accessToken,
  nonce,
}: CreateDpopProofArgs): Promise<string> {
  const header = {
    typ: "dpop+jwt",
    alg: "ES256",
    jwk: await publicJwk(keyPair.publicKey),
  };
  const payload: Record<string, unknown> = {
    jti: generateRandomString(16),
    htm,
    htu,
    iat: Math.floor(Date.now() / 1000),
  };
  if (nonce) payload.nonce = nonce;
  if (accessToken) {
    const digest = await globalThis.crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(accessToken),
    );
    payload.ath = base64UrlEncode(digest);
  }

  const encodedHeader = base64UrlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const encodedPayload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const signature = await globalThis.crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    keyPair.privateKey,
    new TextEncoder().encode(signingInput),
  );

  return `${signingInput}.${base64UrlEncode(signature)}`;
}
