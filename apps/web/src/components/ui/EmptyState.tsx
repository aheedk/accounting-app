import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Inbox } from 'lucide-react';
import { Button } from '@/components/ui/button';

// QBO-style table empty state: a short headline, a hint, and one clear action.
export function EmptyState({
  title,
  hint,
  actionLabel,
  actionTo,
}: {
  title: string;
  hint?: ReactNode;
  actionLabel?: string;
  actionTo?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-10">
      <Inbox className="h-8 w-8 text-muted-foreground/40" />
      <div className="text-sm font-medium text-foreground">{title}</div>
      {hint && <div className="max-w-sm text-center text-sm text-muted-foreground">{hint}</div>}
      {actionLabel && actionTo && (
        <Button asChild size="sm" className="mt-2"><Link to={actionTo}>{actionLabel}</Link></Button>
      )}
    </div>
  );
}
