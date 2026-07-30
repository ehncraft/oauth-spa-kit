import { defineEventHandler, sendWebResponse, toWebRequest } from "h3";
import { createCallbackHandler } from "@oauth-spa-kit/server";
import { resolveHandlersConfig } from "../../utils/config";
import { useRuntimeConfig } from "#imports";

export default defineEventHandler(async (event) => {
  const config = await resolveHandlersConfig(event);
  // On by default, in every environment: a failed callback is a production
  // signal worth having in server logs, not just dev-time noise -- the AS's
  // own error code alone (in the redirect's `login_error` param) doesn't say
  // *why* (expired code, PKCE/DPoP mismatch, JWKS misconfiguration, etc.).
  // Set oauthSpaKit.logCallbackErrors = false to opt out.
  if (useRuntimeConfig(event).oauthSpaKit.logCallbackErrors !== false) {
    config.onCallbackError = (error) => console.error("[oauth-spa-kit] callback failed:", error);
  }
  const handler = createCallbackHandler(config);
  return sendWebResponse(event, await handler(toWebRequest(event)));
});
