import { createError, defineEventHandler, readBody, sendWebResponse } from "h3";
import { evaluateAccessBatch, type AuthzenAction, type AuthzenContext, type AuthzenEntity } from "@oauth-spa-kit/server";
import { resolveCallerSubject } from "../../../utils/resolveCallerSubject";

interface EvaluateBatchEntry {
  action: AuthzenAction;
  resource?: AuthzenEntity;
  context?: AuthzenContext;
}

interface EvaluateBatchBody {
  evaluations: EvaluateBatchEntry[];
}

function unauthorized(headers: Headers): Response {
  return new Response(JSON.stringify({ evaluations: [] }), { status: 401, headers });
}

export default defineEventHandler(async (event) => {
  const body = await readBody<EvaluateBatchBody>(event);
  if (!Array.isArray(body?.evaluations) || body.evaluations.some((entry) => !entry?.action?.name)) {
    throw createError({ statusCode: 400, statusMessage: "evaluations[].action.name is required" });
  }

  const { config, pdpUrl, request, subject } = await resolveCallerSubject(event);

  const headers = new Headers({ "content-type": "application/json" });
  if (!subject) {
    return sendWebResponse(event, unauthorized(headers));
  }
  if (subject.setCookie) headers.set("Set-Cookie", subject.setCookie);

  const evaluated = await evaluateAccessBatch(request, config, { pdpUrl }, {
    subject: subject.result,
    evaluations: body.evaluations,
  });
  if (!evaluated) {
    return sendWebResponse(event, unauthorized(headers));
  }
  if (evaluated.setCookie) headers.set("Set-Cookie", evaluated.setCookie);

  return sendWebResponse(event, new Response(JSON.stringify(evaluated.result), { status: 200, headers }));
});
