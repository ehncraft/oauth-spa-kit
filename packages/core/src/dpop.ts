import { base64UrlEncode } from "./base64url.js";
import { signJwt } from "./jwt.js";
import { generateRandomString } from "./pkce.js";

/**
 * DPoP (RFC 9449) -- sender-constrained tokens. Required by default in this
 * kit (FAPI 2.0 requires DPoP or mTLS for confidential clients; DPoP is the
 * one that doesn't need a client-certificate PKI). Every token request/use
 * is bound to a private key.
 *
 * Keys are generated **extractable**: in the original in-browser design for
 * this kit, non-extractable was the point (an XSS payload executing as the
 * page couldn't exfiltrate the key even with full JS execution). Once
 * everything moved server-side for the BFF pattern, key generation happens
 * in this process, not in a browser tab an attacker's script can run in --
 * the actual risk here is a compromised session store, which encrypting the
 * exported key at rest (via the same AES-256-GCM sealing already used for
 * the session cookie) already covers. Extractability is required in
 * practice anyway: a DPoP-bound refresh token must be renewed with the
 * *same* key that obtained it, and a `CryptoKey` object cannot itself
 * survive across stateless HTTP requests -- only its exported JWK can.
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
    /* extractable */ true,
    ["sign", "verify"],
  );
  return { publicKey, privateKey };
}

export interface SerializedDpopKeyPair {
  privateJwk: JsonWebKey;
  publicJwk: JsonWebKey;
}

/** For persisting a key pair across requests (PKCE cookie during the redirect, session cookie thereafter) -- see the module comment for why extractability is unavoidable here. */
export async function exportDpopKeyPair(keyPair: DpopKeyPair): Promise<SerializedDpopKeyPair> {
  const [privateJwk, publicJwk] = await Promise.all([
    globalThis.crypto.subtle.exportKey("jwk", keyPair.privateKey),
    globalThis.crypto.subtle.exportKey("jwk", keyPair.publicKey),
  ]);
  return { privateJwk, publicJwk };
}

export async function importDpopKeyPair(serialized: SerializedDpopKeyPair): Promise<DpopKeyPair> {
  const params: EcKeyImportParams = { name: "ECDSA", namedCurve: "P-256" };
  const [privateKey, publicKey] = await Promise.all([
    globalThis.crypto.subtle.importKey("jwk", serialized.privateJwk, params, true, ["sign"]),
    globalThis.crypto.subtle.importKey("jwk", serialized.publicJwk, params, true, ["verify"]),
  ]);
  return { privateKey, publicKey };
}

function publicJwkClaims(jwk: JsonWebKey): JsonWebKey {
  // Only the fields the RFC actually requires in a DPoP proof's `jwk` header.
  return { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
}

/**
 * RFC 7638 JWK SHA-256 thumbprint, used as the `dpop_jkt` authorization
 * request parameter (RFC 9449 section 10) -- binds the authorization code
 * itself to this DPoP key, before any token is even issued, so a stolen
 * code can't be redeemed with a different key pair.
 */
export async function computeJwkThumbprint(publicKey: CryptoKey): Promise<string> {
  const jwk = publicJwkClaims(await globalThis.crypto.subtle.exportKey("jwk", publicKey));
  // RFC 7638 section 3: lexicographic member order, no insignificant whitespace.
  const canonical = `{"crv":"${jwk.crv}","kty":"${jwk.kty}","x":"${jwk.x}","y":"${jwk.y}"}`;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return base64UrlEncode(new Uint8Array(digest));
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
    payload.ath = base64UrlEncode(new Uint8Array(digest));
  }

  const publicJwk = publicJwkClaims(await globalThis.crypto.subtle.exportKey("jwk", keyPair.publicKey));
  return signJwt({
    header: { typ: "dpop+jwt", jwk: publicJwk },
    payload,
    privateKey: keyPair.privateKey,
    alg: "ES256",
  });
}
