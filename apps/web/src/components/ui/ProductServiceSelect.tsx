import * as React from 'react';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ProductServiceItem = {
  id: string;
  sku: string;
  name: string;
  sale_price?: string | null;
  description?: string | null;
  income_account_id?: string | null;
};

export interface ProductServiceSelectProps {
  items: ProductServiceItem[];
  value: string;
  onChange: (id: string) => void;
  onAddNew?: () => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  id?: string;
  emptyText?: string;
}

export function ProductServiceSelect({
  items,
  value,
  onChange,
  onAddNew,
  placeholder = 'Select product/service…',
  required,
  disabled,
  className,
  id,
  emptyText = 'No products or services yet.',
}: ProductServiceSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [activeIdx, setActiveIdx] = React.useState(0);
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);

  const selected = items.find((i) => i.id === value) ?? null;

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) => i.sku.toLowerCase().includes(q) || i.name.toLowerCase().includes(q),
    );
  }, [items, query]);

  React.useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
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
    item?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx, open]);

  function pick(i: ProductServiceItem) {
    onChange(i.id);
    setOpen(false);
    setQuery('');
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
      const it = filtered[activeIdx];
      if (it) pick(it);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      setQuery('');
    } else if (e.key === 'Tab') {
      setOpen(false);
      setQuery('');
    }
  }

  function handleAddNew() {
    setOpen(false);
    setQuery('');
    onAddNew?.();
  }

  return (
    <div ref={wrapperRef} className={cn('relative', className)}>
      {open ? (
        <input
          ref={inputRef}
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
          type="button"
          disabled={disabled}
          onClick={() => setOpen(true)}
          className={cn(
            'flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm text-left ring-offset-background',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          {selected ? (
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <span className="font-mono text-xs text-muted-foreground">{selected.sku}</span>
              <span className="truncate">{selected.name}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
          <span aria-hidden className="ml-2 text-muted-foreground">▾</span>
        </button>
      )}
      {required && (
        <input
          tabIndex={-1}
          aria-hidden
          required
          value={value}
          onChange={() => {}}
          onFocus={() => setOpen(true)}
          className="absolute inset-0 h-full w-full opacity-0 -z-10"
        />
      )}
      {open && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border bg-background shadow-md">
          <div className="max-h-72 overflow-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">{emptyText}</div>
            ) : (
              <ul ref={listRef} role="listbox" className="py-1">
                {filtered.map((it, i) => (
                  <li
                    key={it.id}
                    role="option"
                    aria-selected={i === activeIdx}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pick(it);
                    }}
                    onMouseEnter={() => setActiveIdx(i)}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 px-3 py-2 text-sm',
                      i === activeIdx && 'bg-accent text-accent-foreground',
                    )}
                  >
                    <span className="w-20 font-mono text-xs text-muted-foreground">{it.sku}</span>
                    <span className="flex-1 truncate">{it.name}</span>
                    {it.sale_price != null && it.sale_price !== '' && (
                      <span className="font-mono text-xs text-muted-foreground">${it.sale_price}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {onAddNew && (
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                handleAddNew();
              }}
              className="flex w-full items-center gap-2 border-t bg-background px-3 py-2 text-sm text-primary hover:bg-accent"
            >
              <Plus className="h-4 w-4" /> Add new product/service
            </button>
          )}
        </div>
      )}
    </div>
  );
}
