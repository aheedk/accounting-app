import { Link } from 'react-router-dom';

type Active = 'setup' | 'register' | 'summary' | 'history';

/** The four links QuickBooks shows top-right on every reconcile-related page. */
export function ReconcileNav({ active, accountId }: { active: Active; accountId?: string | null | undefined }) {
  const registerHref = accountId ? `/accounting/register?accountId=${accountId}` : '/accounting/register';
  return (
    <div className="flex items-center gap-4 text-sm">
      <Link
        to="/settings/coa"
        className="text-link hover:underline"
      >
        Chart of accounts
      </Link>
      <Link
        to={registerHref}
        className={active === 'register' ? 'font-semibold text-foreground underline' : 'text-link hover:underline'}
      >
        Register
      </Link>
      <Link
        to="/accounting/reconcile/summary"
        className={`inline-flex h-8 items-center rounded-md border px-3 ${active === 'summary' ? 'bg-muted font-medium' : 'bg-background hover:bg-muted/50'}`}
      >
        Summary
      </Link>
      <Link
        to="/accounting/reconcile/history"
        className={`inline-flex h-8 items-center rounded-md border px-3 ${active === 'history' ? 'bg-muted font-medium' : 'bg-background hover:bg-muted/50'}`}
      >
        History by account
      </Link>
    </div>
  );
}
