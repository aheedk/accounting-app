import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Same visual language as EmptyState — a muted icon, a short message, one
 * action — for the case where loading failed instead of came back empty. */
export function ErrorState({
  message = 'Something went wrong loading this page.',
  onRetry,
}: {
  message?: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-10">
      <AlertTriangle className="h-8 w-8 text-muted-foreground/40" />
      <div className="max-w-sm text-center text-sm text-muted-foreground">{message}</div>
      <Button type="button" variant="outline" size="sm" className="mt-1" onClick={onRetry}>Try again</Button>
    </div>
  );
}
