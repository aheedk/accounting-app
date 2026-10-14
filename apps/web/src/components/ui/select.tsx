import React, { useRef, useState, useEffect, useCallback } from 'react';
import { ChevronDown, Check, Search } from 'lucide-react';
import { cn } from '../../lib/utils';

type OptionData = { value: string; label: string; disabled?: boolean | undefined; hint?: string | undefined };

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
      const p = child.props as { value?: string; children?: React.ReactNode; disabled?: boolean; 'data-hint'?: string };
      const label = childrenToText(p.children);
      opts.push({
        // Like a native <select>: an <option> without a value uses its text.
        value: String(p.value ?? label),
        label,
        disabled: p.disabled,
        // An optional right-aligned, italic category badge (QBO-style "Bank",
        // "Credit Card"...) — set via a plain data-hint attribute on <option>
        // so it stays out of the searchable/closed-state label text.
        hint: p['data-hint'],
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
  // Index into `filtered` of the option the arrow keys are on.
  const [activeIdx, setActiveIdx] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
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
  }, [open]);

  // Start on the current value when the list opens, and on the first match
  // when the search text changes.
  const filteredKey = filtered.map(o => o.value).join('\u0000');
  useEffect(() => {
    if (!open) return;
    const current = filtered.findIndex(o => o.value === String(value ?? '') && !o.disabled);
    setActiveIdx(current >= 0 ? current : filtered.findIndex(o => !o.disabled));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- filteredKey stands in for `filtered`
  }, [open, filteredKey]);

  useEffect(() => {
    if (!open || activeIdx < 0) return;
    const item = listRef.current?.children[activeIdx] as HTMLElement | undefined;
    item?.scrollIntoView?.({ block: 'nearest' });
  }, [open, activeIdx]);

  // Next enabled option in `direction`, stopping at the ends like a native select.
  function step(from: number, direction: 1 | -1): number {
    for (let i = from + direction; i >= 0 && i < filtered.length; i += direction) {
      if (!filtered[i]?.disabled) return i;
    }
    return from;
  }

  function close(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }

  function onListKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(i => step(i, 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => step(i < 0 ? filtered.length : i, -1));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActiveIdx(step(-1, 1));
    } else if (e.key === 'End') {
      e.preventDefault();
      setActiveIdx(step(filtered.length, -1));
    } else if (e.key === 'Enter') {
      // Never let Enter submit the surrounding form while the list is open.
      e.preventDefault();
      const active = filtered[activeIdx];
      if (active && !active.disabled) { pick(active.value); triggerRef.current?.focus(); }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === 'Tab') {
      // Hand focus back to the trigger first so Tab continues from this field
      // instead of from the top of the page once the search box unmounts.
      close(true);
    }
  }

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
        'transition-shadow',
        'focus-within:border-ring focus-within:shadow-[0_0_0_2px_rgba(0,119,197,0.15)]',
        open && 'border-ring shadow-[0_0_0_2px_rgba(0,119,197,0.15)]',
        disabled && 'cursor-not-allowed border-border bg-muted opacity-100 text-muted-foreground',
        className,
      )}
      {...(rest as React.HTMLAttributes<HTMLDivElement>)}
    >
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen(prev => !prev)}
        onKeyDown={e => {
          // Like a native select: the arrow keys open the list.
          if (!open && !disabled && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault();
            setOpen(true);
          }
        }}
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
          className="absolute left-0 top-full z-50 mt-1 w-max min-w-full max-w-xs rounded-md border bg-white dark:bg-zinc-900 shadow-xl"
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
              onKeyDown={onListKeyDown}
              role="combobox"
              aria-expanded
              aria-autocomplete="list"
            />
          </div>

          <ul
            ref={listRef}
            role="listbox"
            className="max-h-60 overflow-y-auto py-1 focus:outline-none"
          >
            {filtered.map((opt, index) => {
              const isSelected = opt.value === String(value ?? '');
              const isActive = index === activeIdx;
              return (
                <li
                  key={`${index}-${opt.value}`}
                  role="option"
                  aria-selected={isSelected}
                  data-selected={isSelected}
                  data-active={isActive}
                  aria-disabled={opt.disabled}
                  onClick={() => !opt.disabled && pick(opt.value)}
                  onMouseEnter={() => { if (!opt.disabled) setActiveIdx(index); }}
                  className={cn(
                    'flex cursor-pointer select-none items-center px-3 py-2 text-sm',
                    opt.disabled && 'cursor-not-allowed opacity-40',
                    // The current value stays visibly picked out even once hover/keyboard
                    // focus moves elsewhere — not just bold, a persistent tint.
                    isSelected && 'bg-accent/70',
                    // One highlight for both mouse and keyboard, stronger than the
                    // selected tint so moving off the selected row still reads clearly.
                    isActive && 'bg-accent text-accent-foreground',
                  )}
                >
                  <span className="flex-1 whitespace-nowrap">{opt.label}</span>
                  {opt.hint ? (
                    <span className="ml-2 shrink-0 text-xs italic text-muted-foreground">{opt.hint}</span>
                  ) : (
                    isSelected && <Check className="ml-2 h-3.5 w-3.5 shrink-0 text-link" />
                  )}
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
                className="w-full rounded-sm px-3 py-2 text-left text-sm font-medium text-link hover:bg-accent"
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
