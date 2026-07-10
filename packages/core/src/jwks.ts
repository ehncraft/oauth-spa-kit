import { DiscoveryError } from "./errors.js";
import type { Jwks } from "./jwt.js";

const cache = new Map<string, { jwks: Jwks; fetchedAt: number }>();
const CACHE_TTL_MS = 60 * 60 * 1000;

export async function fetchJwks(jwksUri: string, fetchImpl: typeof fetch = fetch): Promise<Jwks> {
  const cached = cache.get(jwksUri);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.jwks;

  let response: Response;
  try {
    response = await fetchImpl(jwksUri);
  } catch (cause) {
    throw new DiscoveryError(`Failed to fetch JWKS from ${jwksUri}`, cause);
  }
  if (!response.ok) throw new DiscoveryError(`JWKS endpoint ${jwksUri} returned ${response.status}`);

  const jwks = (await response.json()) as Jwks;
  cache.set(jwksUri, { jwks, fetchedAt: Date.now() });
  return jwks;
}
