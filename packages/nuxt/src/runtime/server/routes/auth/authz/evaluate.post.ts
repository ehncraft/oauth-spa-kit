import { createError, defineEventHandler, readBody, sendWebResponse } from "h3";
import { evaluateAccess, type AuthzenAction, type AuthzenContext, type AuthzenEntity } from "@oauth-spa-kit/server";
import { resolveCallerSubject } from "../../../utils/resolveCallerSubject";

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

  const { config, pdpUrl, request, subject } = await resolveCallerSubject(event);

  const headers = new Headers({ "content-type": "application/json" });
  if (!subject) {
    return sendWebResponse(event, unauthorized(headers));
  }
  if (subject.setCookie) headers.set("Set-Cookie", subject.setCookie);

  const evaluated = await evaluateAccess(request, config, { pdpUrl }, {
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
