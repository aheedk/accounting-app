import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, setAccessToken } from '@/lib/apiClient';

export type Role = 'firm_admin' | 'accountant' | 'staff' | 'client';

export type AuthUser = {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  firm_id: string;
};
export type AuthBusiness = { id: string; name: string; role_override: Role | null };

type AuthState = {
  status: 'loading' | 'authenticated' | 'anonymous';
  user: AuthUser | null;
  businesses: AuthBusiness[];
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

export const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthState['status']>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [businesses, setBusinesses] = useState<AuthBusiness[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const me = await api.get('/me');
        setUser(me.data.user);
        setBusinesses(me.data.businesses ?? []);
        setStatus('authenticated');
      } catch { setStatus('anonymous'); }
    })();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api.post('/auth/login', { email, password });
    setAccessToken(r.data.access_token);
    setUser(r.data.user);
    setBusinesses(r.data.businesses ?? []);
    setStatus('authenticated');
  }, []);

  const logout = useCallback(async () => {
    try { await api.post('/auth/logout'); } finally {
      setAccessToken(null);
      setUser(null);
      setBusinesses([]);
      setStatus('anonymous');
    }
  }, []);

  // Re-fetch the current user + business access (e.g. after adding a client).
  const refresh = useCallback(async () => {
    const me = await api.get('/me');
    setUser(me.data.user);
    setBusinesses(me.data.businesses ?? []);
  }, []);

  const value = useMemo<AuthState>(() => ({ status, user, businesses, login, logout, refresh }), [status, user, businesses, login, logout, refresh]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
