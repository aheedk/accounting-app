import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Check, ChevronsUpDown, Plus, Undo2 } from 'lucide-react';
import { useAuth } from '@/auth/useAuth';
import { useActiveBusinessId } from '@/lib/business';
import { cn } from '@/lib/utils';

// QBO-style company switcher: shows the current company and lets you jump to
// another company, return to the firm practice view, or add a client.
// Decision: there is no dedicated create-client flow yet, so "Add client" and
// "Back to practice" both land on the firm practice surface (Client Overview),
// which lists every client in the firm.
const PRACTICE_PATH = '/accounting/client-overview';

export function BusinessSwitcher() {
  const { user, businesses } = useAuth();
  const [active, setActive] = useActiveBusinessId();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (businesses.length === 0) {
    return <span className="text-sm text-muted-foreground">No business access</span>;
  }

  const activeBiz = businesses.find(b => b.id === active) ?? businesses[0];
  const others = businesses.filter(b => b.id !== activeBiz?.id);
  const isFirmAdmin = user?.role === 'firm_admin';

  function choose(id: string) {
    setActive(id);
    setOpen(false);
  }

  function go(path: string) {
    setOpen(false);
    navigate(path);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          'flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm transition-colors',
          'hover:border-primary/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
        )}
      >
        <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="max-w-[14rem] truncate font-medium">{activeBiz?.name}</span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-50 mt-1 w-72 overflow-hidden rounded-lg border bg-card shadow-card"
        >
          <div className="px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Current company
          </div>
          <div className="flex items-center justify-between gap-2 px-3 py-2">
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-gold/15 text-gold">
                <Building2 className="h-4 w-4" />
              </div>
              <span className="truncate text-sm font-medium">{activeBiz?.name}</span>
            </div>
            <Check className="h-4 w-4 shrink-0 text-primary" />
          </div>

          {others.length > 0 && (
            <>
              <div className="border-t px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Other companies
              </div>
              <div className="max-h-64 overflow-y-auto pb-1">
                {others.map(b => (
                  <button
                    key={b.id}
                    type="button"
                    role="menuitem"
                    onClick={() => choose(b.id)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted/60"
                  >
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                      <Building2 className="h-4 w-4" />
                    </div>
                    <span className="truncate">{b.name}</span>
                    {b.role_override && (
                      <span className="ml-auto rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
                        {b.role_override}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </>
          )}

          {isFirmAdmin && (
            <div className="border-t p-1">
              <button
                type="button"
                role="menuitem"
                onClick={() => go(PRACTICE_PATH)}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-muted/60"
              >
                <Plus className="h-4 w-4 text-primary" />
                <span className="font-medium">Add client</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => go(PRACTICE_PATH)}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-muted/60"
              >
                <Undo2 className="h-4 w-4 text-muted-foreground" />
                <span>Back to practice</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
