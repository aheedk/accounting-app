import * as React from 'react';
import { cn } from '@/lib/utils';

export interface ComboInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Suggestions shown under the input; typing anything else is still allowed. */
  options: string[];
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  id?: string;
  /** Shows an "Add new" action pinned under the suggestions. */
  onAddNew?: () => void;
  addNewLabel?: string;
}

/**
 * Free-text input with a suggestion list, styled like the app's other
 * dropdowns. Replaces <input list> + <datalist>, whose popup is drawn by the
 * browser/OS and cannot be styled.
 */
export function ComboInput({
  value, onChange, options, placeholder, required, disabled, className, id,
  onAddNew, addNewLabel = 'Add new',
}: ComboInputProps) {
  const [open, setOpen] = React.useState(false);
  const [activeIdx, setActiveIdx] = React.useState(-1);
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);

  const filtered = React.useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return options;
    // An exact match means the user already picked it: show the full list again.
    if (options.some(option => option.toLowerCase() === q)) return options;
    return options.filter(option => option.toLowerCase().includes(q));
  }, [options, value]);

  React.useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  React.useEffect(() => {
    if (!open || activeIdx < 0) return;
    const item = listRef.current?.children[activeIdx] as HTMLElement | undefined;
    item?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIdx, open]);

  function pick(option: string) {
    onChange(option);
    setOpen(false);
    setActiveIdx(-1);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActiveIdx(i => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && open && activeIdx >= 0 && filtered[activeIdx] !== undefined) {
      // Only swallow Enter when it is choosing a suggestion; otherwise let the form submit.
      e.preventDefault();
      pick(filtered[activeIdx]);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  }

  const showMenu = open && !disabled && (filtered.length > 0 || onAddNew !== undefined);

  return (
    <div ref={wrapperRef} className={cn('relative', className)}>
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={showMenu}
        aria-autocomplete="list"
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        onChange={e => { onChange(e.target.value); setOpen(true); setActiveIdx(-1); }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onKeyDown={onKeyDown}
        className={cn(
          'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 pr-8 text-sm ring-offset-background',
          'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
      />
      <span aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">▾</span>
      {showMenu && (
        <div className="absolute left-0 top-full z-50 mt-1 w-full overflow-hidden rounded-md border bg-background shadow-md">
          {filtered.length > 0 && (
            <ul ref={listRef} role="listbox" className="max-h-60 overflow-auto py-1">
              {filtered.map((option, i) => (
                <li
                  key={option}
                  role="option"
                  aria-selected={i === activeIdx}
                  // mousedown, not click: it must land before the input's blur.
                  onMouseDown={e => { e.preventDefault(); pick(option); }}
                  onMouseEnter={() => setActiveIdx(i)}
                  className={cn(
                    'cursor-pointer truncate px-3 py-2 text-sm',
                    i === activeIdx && 'bg-accent text-accent-foreground',
                    option === value && 'font-medium',
                  )}
                >
                  {option}
                </li>
              ))}
            </ul>
          )}
          {onAddNew && (
            <div className={cn('p-1', filtered.length > 0 && 'border-t')}>
              <button
                type="button"
                onMouseDown={e => e.preventDefault()}
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
