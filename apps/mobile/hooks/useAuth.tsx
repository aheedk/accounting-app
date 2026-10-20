import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import * as SecureStore from 'expo-secure-store';
import {
  api, setAccessToken, getRefreshToken, setRefreshToken, setUnauthorizedHandler, pickErr,
} from '../services/apiClient';

export type Business = { id: string; name: string; role_override: string | null; fiscal_year_start_month: number };
export type AuthUser = { id: string; email: string; full_name: string; role: string; firm_id: string };

type LoginResponse = { access_token: string; refresh_token: string; user: AuthUser; businesses: Business[] };

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
    // Best-effort server-side revoke — if this fails (offline, already
    // expired), the tokens are cleared locally either way, so the session
    // ends on this device regardless.
    const refreshToken = await getRefreshToken();
    if (refreshToken) {
      try { await api.post('/auth/logout-mobile', { refresh_token: refreshToken }); } catch { /* local clear still happens */ }
    }
    await setAccessToken(null);
    await setRefreshToken(null);
    await SecureStore.deleteItemAsync(ACTIVE_BUSINESS_KEY);
    await SecureStore.deleteItemAsync('acct_biometric_password');
    setUser(null);
    setBusinesses([]);
    setActiveBusinessIdState(null);
  }

  // POST /auth/login with { client: 'mobile' } gets the refresh token back in
  // the JSON body (no httpOnly cookie reaches a native client) and a 30-day,
  // single-use, rotate-on-refresh token distinct from the web's. On a 401,
  // apiClient's interceptor tries /auth/refresh-mobile before this handler
  // ever fires — this only runs when that refresh itself failed too, so the
  // session really is over.
  useEffect(() => {
    setUnauthorizedHandler(() => { void logout(); });
    return () => setUnauthorizedHandler(null);
  }, []);

  useEffect(() => {
    void (async () => {
      const savedBiz = await SecureStore.getItemAsync(ACTIVE_BUSINESS_KEY);
      const token = await SecureStore.getItemAsync('acct_access_token');
      const refreshToken = await getRefreshToken();
      // Proceed if either is present — an expired access token with a live
      // refresh token still gets a GET /me retried through the 401 →
      // refresh-mobile → retry path in apiClient's interceptor.
      if (!token && !refreshToken) { setLoading(false); return; }
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
        await setRefreshToken(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function login(email: string, password: string) {
    setError(null);
    try {
      const r = await api.post<LoginResponse>('/auth/login', { email, password, client: 'mobile' });
      await setAccessToken(r.data.access_token);
      await setRefreshToken(r.data.refresh_token);
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
