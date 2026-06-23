import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Copy, MoreHorizontal, Printer, Share2 } from 'lucide-react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type StatusTone = 'neutral' | 'draft' | 'posted' | 'paid' | 'warning' | 'danger';

export type DetailMenuAction = {
  label: string;
  icon?: ReactNode;
  to?: string;
  onSelect?: () => void | Promise<void>;
  disabled?: boolean;
  destructive?: boolean;
};

export type DetailHeaderAction = {
  label: string;
  icon?: ReactNode;
  to?: string;
  onClick?: () => void;
  disabled?: boolean;
  variant?: ButtonProps['variant'];
};

function labelFor(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function toneForStatus(status: string): StatusTone {
  const s = status.toLowerCase();
  if (['draft', 'pending'].includes(s)) return 'draft';
  if (['posted', 'active', 'sent', 'confirmed', 'received', 'fulfilled'].includes(s)) return 'posted';
  if (['paid', 'applied', 'closed'].includes(s)) return 'paid';
  if (['overdue', 'partial'].includes(s)) return 'warning';
  if (['void', 'voided', 'inactive', 'deleted'].includes(s)) return 'danger';
  return 'neutral';
}

function toneClass(tone: StatusTone): string {
  switch (tone) {
    case 'draft':
      return 'bg-amber-100 text-amber-800';
    case 'posted':
      return 'bg-emerald-100 text-emerald-800';
    case 'paid':
      return 'bg-blue-100 text-blue-800';
    case 'warning':
      return 'bg-orange-100 text-orange-800';
    case 'danger':
      return 'bg-rose-100 text-rose-800';
    case 'neutral':
    default:
      return 'bg-muted text-muted-foreground';
  }
}

export function DetailStatusBadge({ status, label }: { status: string; label?: string | undefined }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold', toneClass(toneForStatus(status)))}>
      {label ?? labelFor(status)}
    </span>
  );
}

function HeaderActionButton({ action }: { action: DetailHeaderAction }) {
  const content = (
    <>
      {action.icon}
      {action.label}
    </>
  );
  if (action.to) {
    return (
      <Button asChild variant={action.variant ?? 'default'} disabled={action.disabled}>
        <Link to={action.to}>{content}</Link>
      </Button>
    );
  }
  return (
    <Button type="button" variant={action.variant ?? 'default'} disabled={action.disabled} onClick={action.onClick}>
      {content}
    </Button>
  );
}

export function DetailMoreMenu({ actions }: { actions: DetailMenuAction[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const visible = actions.filter(a => !a.disabled);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  if (visible.length === 0) return null;

  return (
    <div ref={ref} className="relative">
      <Button type="button" variant="outline" size="icon" aria-label="More actions" onClick={() => setOpen(o => !o)}>
        <MoreHorizontal className="h-4 w-4" />
      </Button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-52 overflow-hidden rounded-md border bg-popover py-1 text-sm shadow-md">
          {visible.map(action => {
            const className = cn(
              'flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent',
              action.destructive ? 'text-destructive' : 'text-foreground',
            );
            const content = (
              <>
                {action.icon}
                <span>{action.label}</span>
              </>
            );
            if (action.to) {
              return (
                <Link key={action.label} to={action.to} className={className} onClick={() => setOpen(false)}>
                  {content}
                </Link>
              );
            }
            return (
              <button
                key={action.label}
                type="button"
                className={className}
                onClick={() => {
                  setOpen(false);
                  void action.onSelect?.();
                }}
              >
                {content}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function baseDetailMenuActions(copyText?: string): DetailMenuAction[] {
  const shareUrl = copyText ?? window.location.href;
  const shareAction: DetailMenuAction[] =
    typeof navigator.share === 'function'
      ? [{
        label: 'Share link',
        icon: <Share2 className="h-4 w-4" />,
        onSelect: () => navigator.share({ title: document.title, url: shareUrl }),
      }]
      : [];

  return [
    { label: 'Print', icon: <Printer className="h-4 w-4" />, onSelect: () => window.print() },
    ...shareAction,
    {
      label: 'Copy link',
      icon: <Copy className="h-4 w-4" />,
      onSelect: () => navigator.clipboard?.writeText(shareUrl),
    },
  ];
}

export function DetailPageHeader({
  eyebrow,
  title,
  subtitle,
  status,
  statusLabel,
  totalLabel,
  total,
  actions = [],
  menuActions = [],
}: {
  eyebrow?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  status?: string;
  statusLabel?: string;
  totalLabel?: string;
  total?: ReactNode;
  actions?: DetailHeaderAction[];
  menuActions?: DetailMenuAction[];
}) {
  return (
    <div className="flex flex-col gap-4 border-b pb-5 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0 space-y-2">
        {eyebrow && <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{eyebrow}</div>}
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="min-w-0 text-2xl font-semibold tracking-normal">{title}</h1>
          {status && <DetailStatusBadge status={status} label={statusLabel} />}
        </div>
        {subtitle && <div className="text-sm text-muted-foreground">{subtitle}</div>}
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        {totalLabel && (
          <div className="sm:min-w-36 sm:text-right">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{totalLabel}</div>
            <div className="font-mono text-2xl font-semibold">{total}</div>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {actions.map(action => <HeaderActionButton key={action.label} action={action} />)}
          <DetailMoreMenu actions={menuActions} />
        </div>
      </div>
    </div>
  );
}

export function DetailField({
  label,
  value,
  className,
}: {
  label: string;
  value: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 min-h-5 whitespace-pre-line text-sm">{value || <span className="text-muted-foreground">-</span>}</div>
    </div>
  );
}

export function DetailMetric({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-md border bg-card p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-xl font-semibold">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function DetailActivity({
  items,
}: {
  items: Array<{ label: string; value: ReactNode }>;
}) {
  const visible = items.filter(item => item.value);
  if (visible.length === 0) return <p className="text-sm text-muted-foreground">No activity recorded yet.</p>;
  return (
    <div className="space-y-3">
      {visible.map(item => (
        <div key={item.label} className="flex items-start justify-between gap-4 border-b pb-3 text-sm last:border-b-0 last:pb-0">
          <span className="text-muted-foreground">{item.label}</span>
          <span className="text-right">{item.value}</span>
        </div>
      ))}
    </div>
  );
}
