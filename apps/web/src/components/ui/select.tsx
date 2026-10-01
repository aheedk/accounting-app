import React, { useRef, useState, useEffect, useCallback } from 'react';
import { ChevronDown, Check, Search } from 'lucide-react';
import { cn } from '../../lib/utils';

type OptionData = { value: string; label: string; disabled?: boolean | undefined };

function childrenToText(node: React.ReactNode): string {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') return String(node);
  if (Array.isArray(node)) return node.map(childrenToText).join('');
  if (React.isValidElement(node)) return childrenToText((node.props as { children?: React.ReactNode }).children);
  return '';
}

function parseOptions(children: React.ReactNode): OptionData[] {
  const opts: OptionData[] = [];
  React.Children.forEach(children, child => {
    if (!React.isValidElement(child)) return;
    if (child.type === 'option') {
      const p = child.props as { value?: string; children?: React.ReactNode; disabled?: boolean };
      opts.push({
        value: String(p.value ?? ''),
        label: childrenToText(p.children),
        disabled: p.disabled,
      });
    } else if (child.type === 'optgroup') {
      const gp = child.props as { children?: React.ReactNode };
      opts.push(...parseOptions(gp.children));
    }
  });
  return opts;
}

type AppSelectProps = Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> & {
  onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  /** Shows an "Add new" action pinned under the options. */
  onAddNew?: () => void;
  addNewLabel?: string;
};

export function AppSelect({
  value, onChange, className, disabled, children, onAddNew, addNewLabel = 'Add new', ...rest
}: AppSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const options = parseOptions(children);
  const filtered = query.trim()
    ? options.filter(o => o.label.toLowerCase().includes(query.toLowerCase()))
    : options;

  const selectedOpt = options.find(o => o.value === String(value ?? ''));
  const displayLabel = selectedOpt?.label ?? (options[0]?.label ?? '');

  const pick = useCallback((val: string) => {
    if (onChange) {
      const nativeEvent = new Event('change', { bubbles: true });
      const syntheticEvent = {
        ...nativeEvent,
        target: { value: val } as HTMLSelectElement,
        currentTarget: { value: val } as HTMLSelectElement,
        nativeEvent,
        bubbles: true,
        cancelable: false,
        defaultPrevented: false,
        eventPhase: 0,
        isTrusted: false,
        preventDefault: () => {},
        isDefaultPrevented: () => false,
        stopPropagation: () => {},
        isPropagationStopped: () => false,
        persist: () => {},
        timeStamp: Date.now(),
        type: 'change',
      } as React.ChangeEvent<HTMLSelectElement>;
      onChange(syntheticEvent);
    }
    setOpen(false);
    setQuery('');
  }, [onChange]);

  useEffect(() => {
    if (!open) { setQuery(''); return; }
    setTimeout(() => searchRef.current?.focus(), 0);
    if (listRef.current) {
      const active = listRef.current.querySelector('[data-selected="true"]') as HTMLElement | null;
      if (active) active.scrollIntoView({ block: 'nearest' });
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    // The outer div is the visual element: border, background, height, padding all live here.
    // className from callers merges with these defaults (e.g. w-48 overrides w-full).
    // The inner button is transparent so there's only ever ONE border.
    <div
      ref={containerRef}
      className={cn(
        'relative flex h-9 w-full items-center rounded-md border border-input bg-background text-sm',
        'ring-offset-background transition-colors',
        'focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2',
        open && 'ring-2 ring-ring ring-offset-2',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
      {...(rest as React.HTMLAttributes<HTMLDivElement>)}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen(prev => !prev)}
        className="flex flex-1 items-center justify-between overflow-hidden px-3 py-2 outline-none"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate text-left">{displayLabel}</span>
        <ChevronDown
          className={cn('ml-2 h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div
          className="absolute left-0 top-full z-50 mt-1 w-full rounded-md border bg-white dark:bg-zinc-900 shadow-xl"
        >
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search…"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              onKeyDown={e => {
                if (e.key === 'Escape') { setOpen(false); }
                if (e.key === 'Enter' && filtered.length === 1 && filtered[0]) {
                  pick(filtered[0].value);
                }
              }}
            />
          </div>

          <ul
            ref={listRef}
            role="listbox"
            className="max-h-60 overflow-y-auto py-1 focus:outline-none"
          >
            {filtered.map(opt => {
              const isSelected = opt.value === String(value ?? '');
              return (
                <li
                  key={opt.value}
                  role="option"
                  aria-selected={isSelected}
                  data-selected={isSelected}
                  aria-disabled={opt.disabled}
                  onClick={() => !opt.disabled && pick(opt.value)}
                  className={cn(
                    'flex cursor-pointer select-none items-center px-3 py-2 text-sm',
                    'hover:bg-accent hover:text-accent-foreground',
                    opt.disabled && 'cursor-not-allowed opacity-40',
                    isSelected && 'bg-accent/50 font-medium',
                  )}
                >
                  <span className="flex-1 truncate">{opt.label}</span>
                  {isSelected && <Check className="ml-2 h-3.5 w-3.5 shrink-0 text-primary" />}
                </li>
              );
            })}
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-sm text-muted-foreground">No results</li>
            )}
          </ul>
          {onAddNew && (
            <div className="border-t p-1">
              <button
                type="button"
                onClick={() => { setOpen(false); onAddNew(); }}
                className="w-full rounded-sm px-3 py-2 text-left text-sm font-medium text-primary hover:bg-accent"
              >
                {addNewLabel}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
