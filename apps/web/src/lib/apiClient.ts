import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';

const API_URL = import.meta.env.VITE_API_URL as string;

const ACCESS_TOKEN_KEY = 'acct_access';

export function setAccessToken(token: string | null) {
  if (token === null) localStorage.removeItem(ACCESS_TOKEN_KEY);
  else localStorage.setItem(ACCESS_TOKEN_KEY, token);
}

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function makeClient(): AxiosInstance {
  const client = axios.create({ baseURL: API_URL, withCredentials: true });

  client.interceptors.request.use((cfg: InternalAxiosRequestConfig) => {
    const t = getAccessToken();
    if (t) cfg.headers.Authorization = `Bearer ${t}`;
    return cfg;
  });

  let refreshing: Promise<string | null> | null = null;

  client.interceptors.response.use(
    (r) => r,
    async (error: AxiosError) => {
      const status = error.response?.status;
      const url = error.config?.url ?? '';
      if (status !== 401 || url.includes('/auth/refresh') || url.includes('/auth/login')) throw error;

      if (!refreshing) {
        refreshing = (async () => {
          try {
            const r = await axios.post(`${API_URL}/auth/refresh`, {}, { withCredentials: true });
            setAccessToken(r.data.access_token);
            return r.data.access_token as string;
          } catch { setAccessToken(null); return null; }
          finally { setTimeout(() => { refreshing = null; }, 0); }
        })();
      }
      const newToken = await refreshing;
      if (!newToken || !error.config) throw error;
      error.config.headers = error.config.headers ?? {};
      error.config.headers.Authorization = `Bearer ${newToken}`;
      return client.request(error.config);
    },
  );

  return client;
}

export const api = makeClient();
