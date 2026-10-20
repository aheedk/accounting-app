import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import * as SecureStore from 'expo-secure-store';
import { api, setAccessToken, setUnauthorizedHandler, pickErr } from '../services/apiClient';

export type Business = { id: string; name: string; role_override: string | null; fiscal_year_start_month: number };
export type AuthUser = { id: string; email: string; full_name: string; role: string; firm_id: string };

type LoginResponse = { access_token: string; user: AuthUser; businesses: Business[] };

const ACTIVE_BUSINESS_KEY = 'acct_active_business';

type AuthState = {
  user: AuthUser | null;
  businesses: Business[];
  activeBusinessId: string | null;
  setActiveBusinessId: (id: string) => void;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  error: string | null;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [activeBusinessId, setActiveBusinessIdState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function setActiveBusinessId(id: string) {
    setActiveBusinessIdState(id);
    void SecureStore.setItemAsync(ACTIVE_BUSINESS_KEY, id);
  }

  async function logout() {
    await setAccessToken(null);
    await SecureStore.deleteItemAsync(ACTIVE_BUSINESS_KEY);
    await SecureStore.deleteItemAsync('acct_biometric_password');
    setUser(null);
    setBusinesses([]);
    setActiveBusinessIdState(null);
  }

  // No refresh-token flow yet: the API only hands the refresh token back as an
  // httpOnly cookie (apps/api/src/routes/auth.ts), which is the right call for
  // the browser SPA but doesn't reach a native client the same way. For now a
  // session just lasts the access token's own 15 minutes
  // (JWT_ACCESS_TTL_MINUTES) and then this fires and sends the user back to
  // login. Fixing it for real needs the API to return the refresh token in the
  // JSON body for a mobile-identified request — a deliberate backend change,
  // not something to slip in from here.
  useEffect(() => {
    setUnauthorizedHandler(() => { void logout(); });
    return () => setUnauthorizedHandler(null);
  }, []);

  useEffect(() => {
    void (async () => {
      const savedBiz = await SecureStore.getItemAsync(ACTIVE_BUSINESS_KEY);
      const token = await SecureStore.getItemAsync('acct_access_token');
      if (!token) { setLoading(false); return; }
      try {
        const r = await api.get<{ user: AuthUser; businesses: Business[] }>('/me');
        setUser(r.data.user);
        setBusinesses(r.data.businesses);
        const resolved = savedBiz && r.data.businesses.some(b => b.id === savedBiz)
          ? savedBiz
          : r.data.businesses[0]?.id ?? null;
        if (resolved) setActiveBusinessIdState(resolved);
      } catch {
        await setAccessToken(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function login(email: string, password: string) {
    setError(null);
    try {
      const r = await api.post<LoginResponse>('/auth/login', { email, password });
      await setAccessToken(r.data.access_token);
      setUser(r.data.user);
      setBusinesses(r.data.businesses);
      const first = r.data.businesses[0]?.id ?? null;
      if (first) setActiveBusinessId(first);
    } catch (e: unknown) {
      setError(pickErr(e));
      throw e;
    }
  }

  const value = useMemo<AuthState>(() => ({
    user, businesses, activeBusinessId, setActiveBusinessId, loading, login, logout, error,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [user, businesses, activeBusinessId, loading, error]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
