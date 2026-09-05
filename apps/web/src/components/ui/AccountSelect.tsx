import * as React from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

export type AccountLike = {
  id: string;
  code: string;
  name: string;
  account_type: string;
};

const NORMAL_BALANCE: Record<string, 'DR' | 'CR'> = {
  asset: 'DR',
  expense: 'DR',
  liability: 'CR',
  equity: 'CR',
  revenue: 'CR',
};

export interface AccountSelectProps {
  accounts: AccountLike[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  id?: string;
  ariaLabel?: string;
  emptyText?: string;
  onCreate?: () => void;
}

export function AccountSelect({
  accounts,
  value,
  onChange,
  placeholder = 'Search account by code or name…',
  required,
  disabled,
  className,
  id,
  ariaLabel,
  emptyText = 'No matching accounts',
  onCreate,
}: AccountSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [activeIdx, setActiveIdx] = React.useState(0);
  const [menuPosition, setMenuPosition] = React.useState({ top: 0, left: 0, width: 0 });
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);

  const selected = accounts.find((a) => a.id === value) ?? null;
  const accessibleLabel = ariaLabel && selected
    ? `${ariaLabel}: ${selected.code} ${selected.name}`
    : ariaLabel;

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter(
      (a) =>
        a.code.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q) ||
        a.account_type.toLowerCase().includes(q),
    );
  }, [accounts, query]);

  React.useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (
        wrapperRef.current && !wrapperRef.current.contains(target) &&
        menuRef.current && !menuRef.current.contains(target)
      ) {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  React.useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      setActiveIdx(0);
    }
  }, [open]);

  React.useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  React.useEffect(() => {
    if (!open || !listRef.current) return;
    const item = listRef.current.children[activeIdx] as HTMLElement | undefined;
    item?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIdx, open]);

  function pick(a: AccountLike) {
    onChange(a.id);
    setOpen(false);
    setQuery('');
  }

  function openMenu() {
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (rect) {
      setMenuPosition({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }
    setOpen(true);
  }

  function createAccount() {
    setOpen(false);
    setQuery('');
    onCreate?.();
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const a = filtered[activeIdx];
      if (a) pick(a);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      setQuery('');
    } else if (e.key === 'Tab') {
      setOpen(false);
      setQuery('');
    }
  }

  const menu = open
    ? createPortal(
        <div
          ref={menuRef}
          style={{
            position: 'fixed',
            top: menuPosition.top,
            left: menuPosition.left,
            width: menuPosition.width,
            zIndex: 9999,
          }}
          className="overflow-hidden rounded-md border bg-background shadow-md"
        >
          <div className="max-h-72 overflow-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">{emptyText}</div>
            ) : (
              <ul ref={listRef} role="listbox" className="py-1">
                {filtered.map((a, i) => (
                  <li
                    key={a.id}
                    role="option"
                    aria-selected={i === activeIdx}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pick(a);
                    }}
                    onMouseEnter={() => setActiveIdx(i)}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 px-3 py-2 text-sm',
                      i === activeIdx && 'bg-accent text-accent-foreground',
                    )}
                  >
                    <span className="w-14 font-mono text-xs text-muted-foreground">{a.code}</span>
                    <span className="flex-1 truncate">{a.name}</span>
                    <AccountBadges type={a.account_type} />
                  </li>
                ))}
              </ul>
            )}
          </div>
          {onCreate && (
            <div className="border-t p-1">
              <button
                type="button"
                onClick={createAccount}
                className="w-full rounded-sm px-3 py-2 text-left text-sm font-medium text-primary hover:bg-accent"
              >
                Add new account
              </button>
            </div>
          )}
        </div>,
        document.body,
      )
    : null;

  return (
    <div ref={wrapperRef} className={cn('relative', className)}>
      {open ? (
        <input
          ref={inputRef}
          aria-label={accessibleLabel}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKey}
          placeholder={placeholder}
          className={cn(
            'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
            'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          )}
          autoComplete="off"
        />
      ) : (
        <button
          id={id}
          aria-label={accessibleLabel}
          type="button"
          disabled={disabled}
          onClick={openMenu}
          className={cn(
            'flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm text-left ring-offset-background',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          {selected ? (
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <span className="font-mono text-xs text-muted-foreground">{selected.code}</span>
              <span className="truncate">{selected.name}</span>
              <AccountBadges type={selected.account_type} />
            </span>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
          <span aria-hidden className="ml-2 text-muted-foreground">
            ▾
          </span>
        </button>
      )}
      {required && (
        <input
          tabIndex={-1}
          aria-hidden
          required
          value={value}
          onChange={() => {}}
          onFocus={openMenu}
          className="absolute inset-0 h-full w-full opacity-0 -z-10"
        />
      )}
      {menu}
    </div>
  );
}

function AccountBadges({ type }: { type: string }) {
  const dr = NORMAL_BALANCE[type];
  return (
    <span className="ml-auto inline-flex shrink-0 items-center gap-1">
      <span className="rounded border px-1 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        {type}
      </span>
      {dr && (
        <span
          className={cn(
            'rounded px-1 py-0.5 font-mono text-[10px]',
            dr === 'DR' ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700',
          )}
          title={dr === 'DR' ? 'Normal balance: Debit' : 'Normal balance: Credit'}
        >
          {dr}
        </span>
      )}
    </span>
  );
}
