import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { setSidebarHidden, useSidebarHidden } from '@/lib/sidebarHidden';

/** Hides or shows the sidebar on a wide screen. On a narrow one the menu button opens it as a drawer instead. */
export function SidebarToggle() {
  const hidden = useSidebarHidden();
  const label = hidden ? 'Show the menu' : 'Hide the menu';
  return (
    <button
      type="button"
      onClick={() => setSidebarHidden(!hidden)}
      aria-label={label}
      title={label}
      className="-ml-1 hidden h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:inline-flex"
    >
      {hidden ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
    </button>
  );
}
