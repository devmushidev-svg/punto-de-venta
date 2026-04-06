import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { apiFetch } from "../api/client";

export type UserInfo = {
  id: string;
  username: string;
  displayName: string;
  role: string;
  /** Permisos efectivos (P6); el admin no depende de esta lista en UI. */
  effectivePermissions?: string[];
};

export type OrgInfo = {
  id: string;
  slug: string;
  name: string;
  currencySymbol: string;
  country?: string;
};

type AuthState = {
  token: string | null;
  user: UserInfo | null;
  organization: OrgInfo | null;
  loading: boolean;
  login: (p: {
    organizationSlug?: string;
    organizationId?: string;
    username: string;
    password: string;
  }) => Promise<void>;
  logout: () => void;
  refreshMe: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("pf_token"));
  const [user, setUser] = useState<UserInfo | null>(null);
  const [organization, setOrganization] = useState<OrgInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshMe = useCallback(async () => {
    const t = localStorage.getItem("pf_token");
    if (!t) {
      setUser(null);
      setOrganization(null);
      setLoading(false);
      return;
    }
    try {
      const me = await apiFetch<{ user: UserInfo; organization: OrgInfo }>("/api/auth/me", { token: t });
      setUser(me.user);
      setOrganization(me.organization);
    } catch {
      localStorage.removeItem("pf_token");
      setToken(null);
      setUser(null);
      setOrganization(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshMe();
  }, [refreshMe]);

  useEffect(() => {
    function onPermStale() {
      setToken(null);
      setUser(null);
      setOrganization(null);
    }
    window.addEventListener("pf-auth-stale", onPermStale);
    return () => window.removeEventListener("pf-auth-stale", onPermStale);
  }, []);

  const login = useCallback(
    async (p: { organizationSlug?: string; organizationId?: string; username: string; password: string }) => {
      const res = await apiFetch<{ token: string; user: UserInfo; organization: OrgInfo }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({
          organizationSlug: p.organizationSlug,
          organizationId: p.organizationId,
          username: p.username,
          password: p.password,
        }),
      });
      localStorage.setItem("pf_token", res.token);
      setToken(res.token);
      setUser(res.user);
      setOrganization(res.organization);
    },
    []
  );

  const logout = useCallback(() => {
    localStorage.removeItem("pf_token");
    setToken(null);
    setUser(null);
    setOrganization(null);
  }, []);

  const value = useMemo(
    () => ({ token, user, organization, loading, login, logout, refreshMe }),
    [token, user, organization, loading, login, logout, refreshMe]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside provider");
  return ctx;
}
