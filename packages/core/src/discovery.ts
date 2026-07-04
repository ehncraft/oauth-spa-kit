import { DiscoveryError } from "./errors";
import type { OidcDiscoveryDocument } from "./types";

const cache = new Map<string, { doc: OidcDiscoveryDocument; fetchedAt: number }>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1h -- discovery docs change essentially never, but don't cache forever

/**
 * Fetch and cache `${issuer}/.well-known/openid-configuration`.
 * Prefer passing a static `discoveryDocument` in config for providers whose
 * metadata you already know, to shave a round trip off the first navigation.
 */
export async function discoverOidcConfiguration(
  issuer: string,
  fetchImpl: typeof fetch = fetch,
): Promise<OidcDiscoveryDocument> {
  const cached = cache.get(issuer);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.doc;
  }

  const url = `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`;
  let response: Response;
  try {
    response = await fetchImpl(url);
  } catch (cause) {
    throw new DiscoveryError(`Failed to fetch discovery document from ${url}`, cause);
  }
  if (!response.ok) {
    throw new DiscoveryError(`Discovery endpoint ${url} returned ${response.status}`);
  }

  const doc = (await response.json()) as OidcDiscoveryDocument;
  cache.set(issuer, { doc, fetchedAt: Date.now() });
  return doc;
}
