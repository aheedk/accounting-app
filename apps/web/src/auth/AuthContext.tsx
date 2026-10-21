import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, renewSession, setAccessToken, SETUP_REQUIRED_EVENT } from '@/lib/apiClient';

export type Role = 'firm_admin' | 'accountant' | 'staff' | 'viewer' | 'client';

export type AuthUser = {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  firm_id: string;
  /** False when a firm admin has switched payroll off for this login. */
  payroll_access?: boolean;
  /**
   * Steps left before the app opens: choosing one's own password (it was made
   * by a firm admin), setting up the second step (the firm requires it).
   */
  setup_required?: Array<'password' | 'two_step'>;
  /** The browser signs out after this many minutes with nothing done (the firm's setting). */
  idle_sign_out_minutes?: number;
};
export type AuthBusiness = {
  id: string; name: string; role_override: Role | null;
  /** First month of the company's fiscal year, 1 to 12. See lib/fiscalYear.ts. */
  fiscal_year_start_month?: number;
};

type AuthState = {
  status: 'loading' | 'authenticated' | 'anonymous';
  user: AuthUser | null;
  businesses: AuthBusiness[];
  /** `code` is the 6-digit second step, for a login that has it on. */
  login: (email: string, password: string, code?: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  /** Renews the session, so a step just done (a new password, the second step) takes effect. */
  renew: () => Promise<void>;
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

  const login = useCallback(async (email: string, password: string, code?: string) => {
    const r = await api.post('/auth/login', { email, password, ...(code ? { code } : {}) });
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

  const renew = useCallback(async () => {
    const out = await renewSession();
    if (!out) {
      setUser(null);
      setBusinesses([]);
      setStatus('anonymous');
      return;
    }
    setUser(out.user as AuthUser);
    setBusinesses((out.businesses as AuthBusiness[] | undefined) ?? []);
  }, []);

  // The API refused a call because the login has steps left: show them.
  useEffect(() => {
    const onSetup = () => { void refresh().catch(() => undefined); };
    window.addEventListener(SETUP_REQUIRED_EVENT, onSetup);
    return () => window.removeEventListener(SETUP_REQUIRED_EVENT, onSetup);
  }, [refresh]);

  const value = useMemo<AuthState>(() => ({ status, user, businesses, login, logout, refresh, renew }), [status, user, businesses, login, logout, refresh, renew]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
