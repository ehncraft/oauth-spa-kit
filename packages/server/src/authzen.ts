import { createDpopProof, importDpopKeyPair, type DpopKeyPair } from "@oauth-spa-kit/core";
import { getAuthorizationHeader, type OAuthHandlersConfig } from "./handlers.js";
import { readSession } from "./session.js";

/**
 * OpenID AuthZEN Authorization API 1.0 (https://openid.net/specs/authorization-api-1_0-01.html).
 * Wire types mirror the spec's JSON shapes exactly, snake_case fields
 * included, so a request/response can be copied straight from the spec or a
 * PDP's own docs (OpenFGA, Topaz, Cerbos, Aserto, ...) without a translation
 * layer.
 */
export interface AuthzenEntity {
  type: string;
  id?: string;
  properties?: Record<string, unknown>;
}

export interface AuthzenAction {
  name: string;
  properties?: Record<string, unknown>;
}

export type AuthzenContext = Record<string, unknown>;

export interface AuthzenEvaluationRequest {
  subject: AuthzenEntity;
  resource?: AuthzenEntity;
  action?: AuthzenAction;
  context?: AuthzenContext;
}

export interface AuthzenEvaluationResponse {
  decision: boolean;
  context?: {
    id?: string;
    reason_admin?: Record<string, unknown>;
    reason_user?: Record<string, unknown>;
    [key: string]: unknown;
  };
}

export interface AuthzenEvaluationsRequest {
  /** Defaults applied to every entry in `evaluations` that omits the field. */
  subject?: AuthzenEntity;
  resource?: AuthzenEntity;
  action?: AuthzenAction;
  context?: AuthzenContext;
  evaluations: Array<{
    subject?: AuthzenEntity;
    resource?: AuthzenEntity;
    action?: AuthzenAction;
    context?: AuthzenContext;
  }>;
  options?: {
    evaluations_semantic?: "execute_all" | "deny_on_first_deny" | "permit_on_first_permit";
  };
}

export interface AuthzenEvaluationsResponse {
  evaluations: AuthzenEvaluationResponse[];
}

export interface AuthzenPageRequest {
  token?: string;
}

export interface AuthzenPageResponse {
  next_token?: string;
}

export interface AuthzenResourceSearchRequest {
  subject: AuthzenEntity;
  action: AuthzenAction;
  /** Partial resource -- typically just `{ type }` to scope the search. */
  resource?: Partial<AuthzenEntity>;
  context?: AuthzenContext;
  page?: AuthzenPageRequest;
}

export interface AuthzenResourceSearchResponse {
  results: AuthzenEntity[];
  page?: AuthzenPageResponse;
}

export interface AuthzenSubjectSearchRequest {
  resource: AuthzenEntity;
  action: AuthzenAction;
  /** Partial subject -- typically just `{ type }` to scope the search. */
  subject?: Partial<AuthzenEntity>;
  context?: AuthzenContext;
  page?: AuthzenPageRequest;
}

export interface AuthzenSubjectSearchResponse {
  results: AuthzenEntity[];
  page?: AuthzenPageResponse;
}

export interface AuthzenActionSearchRequest {
  subject: AuthzenEntity;
  resource: AuthzenEntity;
  /** Partial action -- typically just `{ name }` to scope the search. */
  action?: Partial<AuthzenAction>;
  context?: AuthzenContext;
  page?: AuthzenPageRequest;
}

export interface AuthzenActionSearchResponse {
  results: AuthzenAction[];
  page?: AuthzenPageResponse;
}

export class AuthzenError extends Error {
  constructor(message: string, public readonly status?: number, public readonly body?: string) {
    super(message);
    this.name = "AuthzenError";
  }
}

export interface AuthzenClientConfig {
  /** PDP base URL, e.g. `"https://pdp.example.com"` -- the `/access/v1/...` paths are resolved against it. */
  pdpUrl: string;
  fetchImpl?: typeof fetch;
}

export interface AuthzenResult<T> {
  result: T;
  /** Set only when the underlying session's access token was refreshed -- forward this Set-Cookie on your outgoing response. */
  setCookie?: string;
}

function pdpEndpoint(pdpUrl: string, path: string): string {
  return `${pdpUrl.replace(/\/+$/, "")}/${path}`;
}

async function postToPdp<TReq, TRes>(
  authzen: AuthzenClientConfig,
  path: string,
  authorizationHeader: string,
  dpop: { keyPair: DpopKeyPair; accessToken: string } | undefined,
  body: TReq,
): Promise<TRes> {
  const fetchImpl = authzen.fetchImpl ?? fetch;
  const url = pdpEndpoint(authzen.pdpUrl, path);
  const htu = new URL(url);

  async function post(nonce?: string): Promise<Response> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      authorization: authorizationHeader,
    };
    if (dpop) {
      headers.DPoP = await createDpopProof({
        keyPair: dpop.keyPair, htm: "POST", htu: `${htu.origin}${htu.pathname}`, accessToken: dpop.accessToken, nonce,
      });
    }
    return fetchImpl(url, { method: "POST", headers, body: JSON.stringify(body) });
  }

  let response = await post();
  if (response.status === 401 && dpop) {
    const nonce = response.headers.get("DPoP-Nonce");
    if (nonce) response = await post(nonce);
  }

  if (!response.ok) {
    const responseBody = await response.text().catch(() => "");
    throw new AuthzenError(`AuthZEN PDP call to ${path} failed with status ${response.status}`, response.status, responseBody);
  }

  return response.json() as Promise<TRes>;
}

/**
 * Calls the PDP with the caller's own session -- the same DPoP-bound access
 * token `getAuthorizationHeader` would hand to any other upstream resource
 * server -- and returns `null` when there's no session to authorize with,
 * the same "not logged in" signal `getAuthorizationHeader` itself uses.
 */
async function callPdp<TReq, TRes>(
  request: Request,
  config: OAuthHandlersConfig,
  authzen: AuthzenClientConfig,
  path: string,
  body: TReq,
): Promise<AuthzenResult<TRes> | null> {
  const auth = await getAuthorizationHeader(request, config);
  if (!auth) return null;

  const session = await readSession(request, config.session);
  const dpopKeyPair = session?.dpopKeyPair ? await importDpopKeyPair(session.dpopKeyPair) : undefined;
  const accessToken = auth.header.slice(auth.header.indexOf(" ") + 1);

  const result = await postToPdp<TReq, TRes>(
    authzen, path, auth.header, dpopKeyPair ? { keyPair: dpopKeyPair, accessToken } : undefined, body);
  return { result, setCookie: auth.setCookie };
}

/** Single access decision -- `POST /access/v1/evaluation`. */
export async function evaluateAccess(
  request: Request,
  config: OAuthHandlersConfig,
  authzen: AuthzenClientConfig,
  evaluation: AuthzenEvaluationRequest,
): Promise<AuthzenResult<AuthzenEvaluationResponse> | null> {
  return callPdp(request, config, authzen, "access/v1/evaluation", evaluation);
}

/** Batch access decisions in one PDP round trip -- `POST /access/v1/evaluations`. */
export async function evaluateAccessBatch(
  request: Request,
  config: OAuthHandlersConfig,
  authzen: AuthzenClientConfig,
  evaluations: AuthzenEvaluationsRequest,
): Promise<AuthzenResult<AuthzenEvaluationsResponse> | null> {
  return callPdp(request, config, authzen, "access/v1/evaluations", evaluations);
}

/** Which resources the subject can perform `action` on -- `POST /access/v1/search/resource`. */
export async function searchResources(
  request: Request,
  config: OAuthHandlersConfig,
  authzen: AuthzenClientConfig,
  search: AuthzenResourceSearchRequest,
): Promise<AuthzenResult<AuthzenResourceSearchResponse> | null> {
  return callPdp(request, config, authzen, "access/v1/search/resource", search);
}

/** Which subjects can perform `action` on `resource` -- `POST /access/v1/search/subject`. */
export async function searchSubjects(
  request: Request,
  config: OAuthHandlersConfig,
  authzen: AuthzenClientConfig,
  search: AuthzenSubjectSearchRequest,
): Promise<AuthzenResult<AuthzenSubjectSearchResponse> | null> {
  return callPdp(request, config, authzen, "access/v1/search/subject", search);
}

/** Which actions the subject can perform on `resource` -- `POST /access/v1/search/action`. */
export async function searchActions(
  request: Request,
  config: OAuthHandlersConfig,
  authzen: AuthzenClientConfig,
  search: AuthzenActionSearchRequest,
): Promise<AuthzenResult<AuthzenActionSearchResponse> | null> {
  return callPdp(request, config, authzen, "access/v1/search/action", search);
}

export interface SubjectResolverConfig {
  endpoint: string;
  idField?: string;
  subjectType?: string;
  fetchImpl?: typeof fetch;
}

export async function resolveOwnSubject(
  request: Request,
  config: OAuthHandlersConfig,
  resolver: SubjectResolverConfig,
): Promise<AuthzenResult<AuthzenEntity> | null> {
  const auth = await getAuthorizationHeader(request, config);
  if (!auth) return null;

  const session = await readSession(request, config.session);
  const dpopKeyPair = session?.dpopKeyPair ? await importDpopKeyPair(session.dpopKeyPair) : undefined;
  const accessToken = auth.header.slice(auth.header.indexOf(" ") + 1);
  const fetchImpl = resolver.fetchImpl ?? fetch;
  const endpointUrl = new URL(resolver.endpoint);

  async function get(nonce?: string): Promise<Response> {
    const headers: Record<string, string> = { authorization: auth!.header };
    if (dpopKeyPair) {
      headers.DPoP = await createDpopProof({
        keyPair: dpopKeyPair, htm: "GET", htu: `${endpointUrl.origin}${endpointUrl.pathname}`, accessToken, nonce,
      });
    }
    return fetchImpl(resolver.endpoint, { headers });
  }

  let response = await get();
  if (response.status === 401 && dpopKeyPair) {
    const nonce = response.headers.get("DPoP-Nonce");
    if (nonce) response = await get(nonce);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new AuthzenError(`Subject resolver call to ${resolver.endpoint} failed with status ${response.status}`, response.status, body);
  }

  const claims = (await response.json()) as Record<string, unknown>;
  const idField = resolver.idField ?? "membershipId";
  const id = claims[idField];
  if (typeof id !== "string") {
    throw new AuthzenError(`Subject resolver response from ${resolver.endpoint} is missing a string "${idField}" field`);
  }

  return { result: { type: resolver.subjectType ?? "membership", id }, setCookie: auth.setCookie };
}
