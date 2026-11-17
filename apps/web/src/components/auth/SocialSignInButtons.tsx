import { useEffect, useState } from 'react';
import { api, API_URL } from '@/lib/apiClient';

type Providers = { google: boolean; microsoft: boolean };

// QBO's pattern: email/password first, an "or" divider, then the social
// buttons — never above the form. No "sign up with ..." exists: a login is
// always made by an admin first; a provider only ever attaches to one that
// already exists (services/auth/socialAuthService.ts). Spec:
// docs/specs/2026-11-17-auth-email-lifecycle-and-social-login-design.md
export function SocialSignInButtons() {
  const [providers, setProviders] = useState<Providers | null>(null);

  useEffect(() => {
    api.get<Providers>('/auth/social-providers').then(r => setProviders(r.data)).catch(() => setProviders({ google: false, microsoft: false }));
  }, []);

  if (!providers || (!providers.google && !providers.microsoft)) return null;

  return (
    <div className="mt-6">
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-border" />
        <span className="text-xs text-muted-foreground">or</span>
        <div className="h-px flex-1 bg-border" />
      </div>
      <div className="mt-4 space-y-2">
        {providers.google && (
          <a
            href={`${API_URL}/auth/google`}
            className="flex h-11 w-full items-center justify-center gap-3 rounded-lg border bg-white text-sm font-medium text-[#3c4043] shadow-sm hover:bg-gray-50"
          >
            <GoogleIcon /> Sign in with Google
          </a>
        )}
        {providers.microsoft && (
          <a
            href={`${API_URL}/auth/microsoft`}
            className="flex h-11 w-full items-center justify-center gap-3 rounded-lg border bg-white text-sm font-medium text-[#1b1b1b] shadow-sm hover:bg-gray-50"
          >
            <MicrosoftIcon /> Sign in with Microsoft
          </a>
        )}
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" />
      <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
      <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
      <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" />
    </svg>
  );
}

function MicrosoftIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}
