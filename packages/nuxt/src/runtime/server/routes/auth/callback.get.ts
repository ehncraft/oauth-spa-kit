import { defineEventHandler, sendWebResponse, toWebRequest } from "h3";
import { createCallbackHandler } from "@oauth-spa-kit/server";
import { resolveHandlersConfig } from "../../utils/config";

export default defineEventHandler(async (event) => {
  const handler = createCallbackHandler(await resolveHandlersConfig(event));
  return sendWebResponse(event, await handler(toWebRequest(event)));
});
