import { base64UrlDecode, base64UrlDecodeJson, base64UrlEncode, base64UrlEncodeJson } from "./base64url";
import { OAuthError } from "./errors";

/**
 * PS256 (RSA-PSS) and ES256 (ECDSA P-256) only -- no RS256. FAPI 2.0
 * Security Profile requires PS256 or ES256 for asymmetric client/request
 * signing; RS256's PKCS#1 v1.5 padding is legacy and excluded. Both
 * remaining algorithms are FIPS 140-approved (FIPS 186-4/186-5) given
 * approved parameters (RSA >=2048-bit for PS256, P-256 for ES256).
 */
export type JwtAlgorithm = "PS256" | "ES256";

export class JwtVerificationError extends OAuthError {
  constructor(message: string) {
    super(message);
    this.name = "JwtVerificationError";
  }
}

function signVerifyParams(alg: JwtAlgorithm): RsaPssParams | EcdsaParams {
  switch (alg) {
    case "PS256": return { name: "RSA-PSS", saltLength: 32 }; // salt length = SHA-256 digest size, per RFC 7518 section 3.5
    case "ES256": return { name: "ECDSA", hash: "SHA-256" };
  }
}

function importParams(alg: JwtAlgorithm): RsaHashedImportParams | EcKeyImportParams {
  switch (alg) {
    case "PS256": return { name: "RSA-PSS", hash: "SHA-256" };
    case "ES256": return { name: "ECDSA", namedCurve: "P-256" };
  }
}

export interface SignJwtArgs {
  /** Merged over `{ alg, typ: "JWT" }` -- pass `typ`/`kid`/`jwk` etc. here to override or extend. */
  header?: Record<string, unknown>;
  payload: Record<string, unknown>;
  privateKey: CryptoKey;
  alg: JwtAlgorithm;
}

export async function signJwt({ header = {}, payload, privateKey, alg }: SignJwtArgs): Promise<string> {
  const fullHeader = { alg, typ: "JWT", ...header };
  const signingInput = `${base64UrlEncodeJson(fullHeader)}.${base64UrlEncodeJson(payload)}`;
  const signature = await globalThis.crypto.subtle.sign(
    signVerifyParams(alg),
    privateKey,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
}

export interface Jwks {
  keys: (JsonWebKey & { kid?: string; alg?: string })[];
}

async function importVerificationKey(jwk: JsonWebKey, alg: JwtAlgorithm): Promise<CryptoKey> {
  return globalThis.crypto.subtle.importKey("jwk", jwk, importParams(alg), false, ["verify"]);
}

function algFromJwtHeader(header: Record<string, unknown>): JwtAlgorithm {
  if (header.alg === "PS256" || header.alg === "ES256") return header.alg;
  throw new JwtVerificationError(
    `Unsupported or missing JWT "alg": ${String(header.alg)} (only PS256/ES256 are accepted -- RS256 and HMAC algs are rejected for FAPI/FIPS compliance)`,
  );
}

export interface VerifyJwtArgs {
  token: string;
  jwks: Jwks;
  expectedIssuer: string;
  expectedAudience: string;
  expectedNonce?: string;
  /** Seconds of leeway on `exp`/`iat` checks, to tolerate clock skew between this server and the IdP. */
  clockToleranceSeconds?: number;
}

export interface VerifiedJwt {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
}

/**
 * Verify a JWT's signature against a JWKS and its standard claims. Used to
 * verify `id_token`s (RFC 9449 has nothing to do with this -- this is plain
 * OIDC core section 3.1.3.7) before any of its claims are trusted.
 */
export async function verifyJwt({
  token,
  jwks,
  expectedIssuer,
  expectedAudience,
  expectedNonce,
  clockToleranceSeconds = 60,
}: VerifyJwtArgs): Promise<VerifiedJwt> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new JwtVerificationError("Malformed JWT: expected 3 dot-separated parts");
  const [encodedHeader, encodedPayload, encodedSignature] = parts;

  const header = base64UrlDecodeJson<Record<string, unknown>>(encodedHeader);
  const payload = base64UrlDecodeJson<Record<string, unknown>>(encodedPayload);
  const alg = algFromJwtHeader(header);

  const candidates = header.kid
    ? jwks.keys.filter((key) => key.kid === header.kid)
    : jwks.keys.filter((key) => !key.alg || key.alg === alg);
  if (candidates.length === 0) {
    throw new JwtVerificationError(`No matching JWKS key found for kid=${String(header.kid)} alg=${alg}`);
  }

  let verified = false;
  for (const jwk of candidates) {
    const key = await importVerificationKey(jwk, alg);
    const ok = await globalThis.crypto.subtle.verify(
      signVerifyParams(alg),
      key,
      base64UrlDecode(encodedSignature),
      new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
    );
    if (ok) { verified = true; break; }
  }
  if (!verified) throw new JwtVerificationError("JWT signature verification failed against all candidate JWKS keys");

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === "number" && now > payload.exp + clockToleranceSeconds) {
    throw new JwtVerificationError("JWT has expired");
  }
  if (payload.iss !== expectedIssuer) {
    throw new JwtVerificationError(`JWT "iss" mismatch: expected ${expectedIssuer}, got ${String(payload.iss)}`);
  }
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(expectedAudience)) {
    throw new JwtVerificationError(`JWT "aud" does not include expected client_id ${expectedAudience}`);
  }
  if (expectedNonce !== undefined && payload.nonce !== expectedNonce) {
    throw new JwtVerificationError("JWT \"nonce\" does not match the nonce sent in the authorization request");
  }

  return { header, payload };
}
