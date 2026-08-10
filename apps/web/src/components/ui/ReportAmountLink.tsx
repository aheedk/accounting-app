import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

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
