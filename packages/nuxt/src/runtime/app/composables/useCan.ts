import { useRequestFetch } from "#imports";
import type { AuthzenAction, AuthzenContext, AuthzenEntity, AuthzenEvaluationResponse, AuthzenEvaluationsResponse } from "@oauth-spa-kit/server";

export interface CanCheck {
  action: string | AuthzenAction;
  resource?: AuthzenEntity;
  context?: AuthzenContext;
}

export interface CanResult {
  decision: boolean;
  ok: boolean;
  error?: unknown;
}

export interface CanManyResult {
  decisions: boolean[];
  ok: boolean;
  error?: unknown;
}

function toAuthzenAction(action: string | AuthzenAction): AuthzenAction {
  return typeof action === "string" ? { name: action } : action;
}

export function useCan() {
  const requestFetch = useRequestFetch();

  async function canDetailed(action: string | AuthzenAction, resource?: AuthzenEntity, context?: AuthzenContext): Promise<CanResult> {
    try {
      const body = await requestFetch<AuthzenEvaluationResponse>("/auth/authz/evaluate", {
        method: "POST",
        body: { action: toAuthzenAction(action), resource, context },
      });
      return { decision: body.decision === true, ok: true };
    } catch (error) {
      return { decision: false, ok: false, error };
    }
  }

  async function can(action: string | AuthzenAction, resource?: AuthzenEntity, context?: AuthzenContext): Promise<boolean> {
    return (await canDetailed(action, resource, context)).decision;
  }

  async function canManyDetailed(checks: CanCheck[]): Promise<CanManyResult> {
    if (checks.length === 0) return { decisions: [], ok: true };
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
      return { decisions: checks.map((_, index) => body.evaluations[index]?.decision === true), ok: true };
    } catch (error) {
      return { decisions: checks.map(() => false), ok: false, error };
    }
  }

  async function canMany(checks: CanCheck[]): Promise<boolean[]> {
    return (await canManyDetailed(checks)).decisions;
  }

  return { can, canMany, canDetailed, canManyDetailed };
}
