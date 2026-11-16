// A convenience for the sign-in page only, not an account list: the email of
// whoever last signed in successfully here, so the field is pre-filled next
// time. docs/specs/2026-11-15-user-invitations-and-signin-design.md
const KEY = 'acct_remembered_email';

export function rememberEmail(email: string): void {
  try { localStorage.setItem(KEY, email); } catch { /* the convenience is skipped, not the sign-in */ }
}

export function getRememberedEmail(): string | null {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

export function forgetEmail(): void {
  try { localStorage.removeItem(KEY); } catch { /* nothing to clear */ }
}
