import type { AuthzenAction, AuthzenContext, AuthzenEntity, AuthzenEvaluationResponse } from "@oauth-spa-kit/server";

export function useCan() {
  async function can(action: string | AuthzenAction, resource?: AuthzenEntity, context?: AuthzenContext): Promise<boolean> {
    try {
      const response = await fetch("/auth/authz/evaluate", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: typeof action === "string" ? { name: action } : action,
          resource,
          context,
        }),
      });
      if (!response.ok) return false;

      const body = (await response.json()) as AuthzenEvaluationResponse;
      return body.decision === true;
    } catch {
      return false;
    }
  }

  return { can };
}
