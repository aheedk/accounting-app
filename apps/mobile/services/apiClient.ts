import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import * as SecureStore from 'expo-secure-store';

// Local dev default: the iOS Simulator shares the Mac's own network stack, so
// http://localhost:4000 reaches the same `npm run dev` API the web app uses.
// A physical device needs the Mac's LAN IP instead (EXPO_PUBLIC_API_URL in
// apps/mobile/.env) since "localhost" on a phone means the phone itself.
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';

const ACCESS_TOKEN_KEY = 'acct_access_token';
const REFRESH_TOKEN_KEY = 'acct_refresh_token';

// expo-secure-store is synchronous-feeling but its API is async (it's backed
// by iOS Keychain / Android Keystore, not AsyncStorage — this is the one the
// brief asked for specifically, because AsyncStorage is unencrypted).
export async function setAccessToken(token: string | null): Promise<void> {
  if (token === null) await SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY);
  else await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, token);
}

export async function getAccessToken(): Promise<string | null> {
  return SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
}

export async function setRefreshToken(token: string | null): Promise<void> {
  if (token === null) await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
  else await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, token);
}

export async function getRefreshToken(): Promise<string | null> {
  return SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
}

/** Called once, after a refresh attempt also failed — see useAuth.tsx. */
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
}

// POST /auth/refresh-mobile is the mobile counterpart of the web's
// cookie-based /auth/refresh: the API has no httpOnly cookie to read from a
// native client, so the refresh token travels in the body instead, and the
// mobile app is responsible for storing the rotated one it gets back.
// A bare axios call (no interceptors) so this never recurses into itself.
async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = await getRefreshToken();
  if (!refreshToken) return null;
  try {
    const res = await axios.post<{ access_token: string; refresh_token: string }>(
      `${API_URL}/auth/refresh-mobile`,
      { refresh_token: refreshToken },
    );
    await setAccessToken(res.data.access_token);
    await setRefreshToken(res.data.refresh_token);
    return res.data.access_token;
  } catch {
    return null;
  }
}

// Concurrent 401s during the same tick share one in-flight refresh instead of
// each kicking off their own rotation (which would race: only the first
// rotated token stays valid, and the rest would be refreshing an
// already-revoked token).
let refreshInFlight: Promise<string | null> | null = null;
function refreshOnce(): Promise<string | null> {
  refreshInFlight ??= refreshAccessToken().finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

export function makeClient(): AxiosInstance {
  const client = axios.create({ baseURL: API_URL });

  client.interceptors.request.use(async (cfg: InternalAxiosRequestConfig) => {
    const t = await getAccessToken();
    if (t) cfg.headers.Authorization = `Bearer ${t}`;
    return cfg;
  });

  client.interceptors.response.use(
    r => r,
    async (error: unknown) => {
      const status = (error as { response?: { status?: number } })?.response?.status;
      const config = (error as { config?: InternalAxiosRequestConfig & { _retried?: boolean } })?.config;
      const url = config?.url ?? '';
      const isAuthEndpoint = url.includes('/auth/login') || url.includes('/auth/refresh-mobile');

      if (status === 401 && !isAuthEndpoint && config && !config._retried) {
        config._retried = true;
        const newAccessToken = await refreshOnce();
        if (newAccessToken) {
          config.headers.Authorization = `Bearer ${newAccessToken}`;
          return client(config);
        }
        await setAccessToken(null);
        await setRefreshToken(null);
        onUnauthorized?.();
      }
      throw error;
    },
  );

  return client;
}

export const api = makeClient();

type ApiErrorPayload = { message?: string; field_errors?: Record<string, string[] | undefined> | null };
type ApiErrorShape = { response?: { data?: { error?: ApiErrorPayload } } };

/** Same shape/behavior as apps/web/src/lib/apiErrors.ts's pickErr — kept as
 * its own small copy here rather than pulled into packages/shared, so this
 * first mobile chunk doesn't touch the stable web app's imports. Worth
 * de-duplicating into packages/shared later alongside the rest of the API
 * layer once the mobile app's own shape has settled. */
export function pickErr(e: unknown): string {
  const err = (e as ApiErrorShape | undefined)?.response?.data?.error;
  if (!err) return 'Something went wrong';
  const fields = err.field_errors;
  if (fields) {
    const parts = Object.entries(fields)
      .filter((entry): entry is [string, string[]] => Array.isArray(entry[1]) && entry[1].length > 0)
      .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v[0]}`);
    if (parts.length > 0) return parts.join(' · ');
  }
  return err.message ?? 'Something went wrong';
}
