import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useEscapeToClose } from '@/lib/useCloseForm';

/** The X at the top right of an entry screen; Escape does the same. Pair it with useCloseForm. */
export function CloseFormButton({ onClose, className }: { onClose: () => void; className?: string }) {
  useEscapeToClose(onClose);
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label="Close"
      title="Close (Esc)"
      className={cn('ml-auto rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground', className)}
    >
      <X className="h-5 w-5" />
    </button>
  );
}
