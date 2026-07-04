import { createContext, useEffect, useMemo, type ReactNode } from "react";
import { createSessionClient, type SessionClient, type SessionClientOptions } from "@oauth-spa-kit/core";

export const AuthContext = createContext<SessionClient | null>(null);

export interface AuthProviderProps extends SessionClientOptions {
  children: ReactNode;
}

/** Mount once near the app root. Fetches `/auth/session` on mount, same as nuxt-auth-utils' client plugin does on hydration. */
export function AuthProvider({ children, ...options }: AuthProviderProps) {
  const client = useMemo(() => createSessionClient(options), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void client.refresh();
  }, [client]);

  return <AuthContext.Provider value={client}>{children}</AuthContext.Provider>;
}
