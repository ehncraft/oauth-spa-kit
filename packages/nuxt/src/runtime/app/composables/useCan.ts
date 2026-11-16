import type { AuthzenAction, AuthzenContext, AuthzenEntity, AuthzenEvaluationResponse, AuthzenEvaluationsResponse } from "@oauth-spa-kit/server";

export interface CanCheck {
  action: string | AuthzenAction;
  resource?: AuthzenEntity;
  context?: AuthzenContext;
}

function toAuthzenAction(action: string | AuthzenAction): AuthzenAction {
  return typeof action === "string" ? { name: action } : action;
}

export function useCan() {
  async function can(action: string | AuthzenAction, resource?: AuthzenEntity, context?: AuthzenContext): Promise<boolean> {
    try {
      const response = await fetch("/auth/authz/evaluate", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: toAuthzenAction(action), resource, context }),
      });
      if (!response.ok) return false;

      const body = (await response.json()) as AuthzenEvaluationResponse;
      return body.decision === true;
    } catch {
      return false;
    }
  }

  async function canMany(checks: CanCheck[]): Promise<boolean[]> {
    if (checks.length === 0) return [];
    try {
      const response = await fetch("/auth/authz/evaluate-batch", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          evaluations: checks.map((check) => ({
            action: toAuthzenAction(check.action),
            resource: check.resource,
            context: check.context,
          })),
        }),
      });
      if (!response.ok) return checks.map(() => false);

      const body = (await response.json()) as AuthzenEvaluationsResponse;
      return checks.map((_, index) => body.evaluations[index]?.decision === true);
    } catch {
      return checks.map(() => false);
    }
  }

  return { can, canMany };
}
