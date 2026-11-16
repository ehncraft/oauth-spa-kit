import { createError, defineEventHandler, readBody, sendWebResponse, toWebRequest } from "h3";
import { evaluateAccess, resolveOwnSubject, type AuthzenAction, type AuthzenContext, type AuthzenEntity } from "@oauth-spa-kit/server";
import { resolveAuthzenConfig, resolveHandlersConfig } from "../../../utils/config";

interface EvaluateBody {
  action: AuthzenAction;
  resource?: AuthzenEntity;
  context?: AuthzenContext;
}

function unauthorized(headers: Headers): Response {
  return new Response(JSON.stringify({ decision: false }), { status: 401, headers });
}

export default defineEventHandler(async (event) => {
  const body = await readBody<EvaluateBody>(event);
  if (!body?.action?.name) {
    throw createError({ statusCode: 400, statusMessage: "action.name is required" });
  }

  const config = await resolveHandlersConfig(event);
  const authzen = resolveAuthzenConfig(event);
  const request = toWebRequest(event);

  const subject = await resolveOwnSubject(request, config, {
    endpoint: authzen.subjectEndpoint,
    idField: authzen.subjectIdField,
    subjectType: authzen.subjectType,
  });

  const headers = new Headers({ "content-type": "application/json" });
  if (!subject) {
    return sendWebResponse(event, unauthorized(headers));
  }
  if (subject.setCookie) headers.set("Set-Cookie", subject.setCookie);

  const evaluated = await evaluateAccess(request, config, { pdpUrl: authzen.pdpUrl }, {
    subject: subject.result,
    action: body.action,
    resource: body.resource,
    context: body.context,
  });
  if (!evaluated) {
    return sendWebResponse(event, unauthorized(headers));
  }
  if (evaluated.setCookie) headers.set("Set-Cookie", evaluated.setCookie);

  return sendWebResponse(event, new Response(JSON.stringify(evaluated.result), { status: 200, headers }));
});
