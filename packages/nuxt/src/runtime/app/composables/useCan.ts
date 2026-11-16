import { useRequestFetch } from "#imports";
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
  const requestFetch = useRequestFetch();

  async function can(action: string | AuthzenAction, resource?: AuthzenEntity, context?: AuthzenContext): Promise<boolean> {
    try {
      const body = await requestFetch<AuthzenEvaluationResponse>("/auth/authz/evaluate", {
        method: "POST",
        body: { action: toAuthzenAction(action), resource, context },
      });
      return body.decision === true;
    } catch {
      return false;
    }
  }

  async function canMany(checks: CanCheck[]): Promise<boolean[]> {
    if (checks.length === 0) return [];
    try {
      const body = await requestFetch<AuthzenEvaluationsResponse>("/auth/authz/evaluate-batch", {
        method: "POST",
        body: {
          evaluations: checks.map((check) => ({
            action: toAuthzenAction(check.action),
            resource: check.resource,
            context: check.context,
          })),
        },
      });
      return checks.map((_, index) => body.evaluations[index]?.decision === true);
    } catch {
      return checks.map(() => false);
    }
  }

  return { can, canMany };
}
