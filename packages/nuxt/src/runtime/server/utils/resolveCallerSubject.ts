import { toWebRequest, type H3Event } from "h3";
import { resolveOwnSubject, type AuthzenEntity, type AuthzenResult, type OAuthHandlersConfig } from "@oauth-spa-kit/server";
import { resolveAuthzenConfig, resolveHandlersConfig } from "./config";

export interface CallerSubjectContext {
  config: OAuthHandlersConfig;
  pdpUrl: string;
  request: Request;
  subject: AuthzenResult<AuthzenEntity> | null;
}

export async function resolveCallerSubject(event: H3Event): Promise<CallerSubjectContext> {
  const config = await resolveHandlersConfig(event);
  const authzen = resolveAuthzenConfig(event);
  const request = toWebRequest(event);
  const subject = await resolveOwnSubject(request, config, {
    endpoint: authzen.subjectEndpoint,
    idField: authzen.subjectIdField,
    subjectType: authzen.subjectType,
  });
  return { config, pdpUrl: authzen.pdpUrl, request, subject };
}
