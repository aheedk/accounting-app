/// <reference types="vite/client" />
import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';

const API_URL = import.meta.env.VITE_API_URL as string;

const ACCESS_TOKEN_KEY = 'acct_access';
// When the session was last signed in or renewed, shared by the tabs (see lib/idleSession.ts).
const RENEWED_AT_KEY = 'acct_renewed_at';

export function setAccessToken(token: string | null) {
  if (token === null) {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(RENEWED_AT_KEY);
  } else {
    localStorage.setItem(ACCESS_TOKEN_KEY, token);
    localStorage.setItem(RENEWED_AT_KEY, String(Date.now()));
  }
}

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

/** When the session was last signed in or renewed in this browser, epoch ms (0 when unknown). */
export function lastRenewedAt(): number {
  return Number(localStorage.getItem(RENEWED_AT_KEY) ?? 0) || 0;
}

/** What signing in and renewing return. */
export type SessionPayload = { access_token: string; user: unknown; businesses: unknown };

let refreshing: Promise<SessionPayload | null> | null = null;

/**
 * Renews the session with the refresh cookie and keeps the new token. One
 * renewal at a time: callers at the same moment share it, as the API refuses a
 * sign-in key that has just been replaced. `keepTokenOnFailure` is for the
 * background renewal while someone is active, which must not sign a tab out
 * because another tab renewed a moment before.
 */
export function renewSession(opts: { keepTokenOnFailure?: boolean } = {}): Promise<SessionPayload | null> {
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const r = await axios.post<SessionPayload>(`${API_URL}/auth/refresh`, {}, { withCredentials: true });
        setAccessToken(r.data.access_token);
        return r.data;
      } catch {
        if (!opts.keepTokenOnFailure) {
          setAccessToken(null);
          window.dispatchEvent(new Event(SESSION_ENDED_EVENT));
        }
        return null;
      } finally { setTimeout(() => { refreshing = null; }, 0); }
    })();
  }
  return refreshing;
}

/** Fired when the API says the login has steps left (a firm admin's password, the second step). */
export const SETUP_REQUIRED_EVENT = 'acct:setup-required';
/** Fired when the session could not be renewed: it ended (12 hours, signed out elsewhere, a new password). */
export const SESSION_ENDED_EVENT = 'acct:session-ended';

export function makeClient(): AxiosInstance {
  const client = axios.create({ baseURL: API_URL, withCredentials: true });

  client.interceptors.request.use((cfg: InternalAxiosRequestConfig) => {
    const t = getAccessToken();
    if (t) cfg.headers.Authorization = `Bearer ${t}`;
    return cfg;
  });

  client.interceptors.response.use(
    (r) => {
      // The approval step: in a company that asks for it, a staff login's entry is
      // held for an accountant and nothing is recorded. Forms expect the record
      // back, so this is handed to them as a failure that says what happened, and
      // every form's own error line shows it without knowing about approvals.
      if (r.status === 202 && (r.data as { pending_approval?: boolean } | undefined)?.pending_approval) {
        const message = (r.data as { message?: string }).message ?? 'Sent for approval.';
        return Promise.reject(Object.assign(new Error(message), {
          pendingApproval: true,
          response: { status: 202, data: { error: { code: 'PENDING_APPROVAL', message } } },
        }));
      }
      return r;
    },
    async (error: AxiosError) => {
      const status = error.response?.status;
      const url = error.config?.url ?? '';
      // The firm turned on the second step, say, while this person was signed in: the app shows the set-up.
      if (status === 403 && (error.response?.data as { error?: { code?: string } } | undefined)?.error?.code === 'ACCOUNT_SETUP_REQUIRED') {
        window.dispatchEvent(new Event(SETUP_REQUIRED_EVENT));
      }
      if (status !== 401 || url.includes('/auth/refresh') || url.includes('/auth/login')) throw error;

      const newToken = (await renewSession())?.access_token ?? null;
      if (!newToken || !error.config) throw error;
      error.config.headers = error.config.headers ?? {};
      error.config.headers.Authorization = `Bearer ${newToken}`;
      return client.request(error.config);
    },
  );

  return client;
}

export const api = makeClient();
