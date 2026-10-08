import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { canOpenPage, useEffectiveRole } from '@/lib/roleAccess';

export function ReportAmountLink({
  to,
  title,
  className,
  children,
}: {
  to: string;
  title: string;
  className?: string;
  children: ReactNode;
}) {
  // A role that cannot open where the amount leads (a client and the General
  // Ledger) sees the figure as plain text, not a link to a page it is refused.
  const role = useEffectiveRole();
  if (!canOpenPage(role, to.split('?')[0] ?? to)) return <span className={className}>{children}</span>;

  return (
    <Link
      to={to}
      title={title}
      className={cn(
        'text-primary underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none',
        className,
      )}
    >
      {children}
    </Link>
  );
}
