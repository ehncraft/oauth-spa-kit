import { useContext, useSyncExternalStore } from "react";
import type { SessionState } from "@oauth-spa-kit/core";
import { AuthContext } from "./AuthProvider";

export interface UseAuthResult extends SessionState {
  login: (returnTo?: string) => void;
  logout: () => Promise<void>;
}

export function useAuth(): UseAuthResult {
  const client = useContext(AuthContext);
  if (!client) throw new Error("useAuth() must be used within <AuthProvider>");

  const state = useSyncExternalStore(client.subscribe, client.getState, client.getState);

  return {
    ...state,
    login: client.login,
    logout: client.logout,
  };
}
