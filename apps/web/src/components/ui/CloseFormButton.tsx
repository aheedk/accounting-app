import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

/** The X at the top right of an entry screen. Pair it with useCloseForm. */
export function CloseFormButton({ onClose, className }: { onClose: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label="Close"
      title="Close"
      className={cn('ml-auto rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground', className)}
    >
      <X className="h-5 w-5" />
    </button>
  );
}
