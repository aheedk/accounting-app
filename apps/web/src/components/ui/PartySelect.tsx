import * as React from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

export type Party = { id: string; type: 'vendor' | 'customer'; name: string };

export interface PartySelectProps {
  parties: Party[];
  /** The selected party's id, or '' for "typed text, no match picked". */
  value: string;
  /** Free-text the user has typed when no party is selected (payee_text). */
  text: string;
  onPick: (party: Party) => void;
  onTextChange: (text: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
}

/**
 * Searchable dropdown over vendors and customers combined — who an Expense is
 * paid to. Mirrors AccountSelect's UX (portal menu, keyboard nav) but allows
 * falling through to free text when nothing matches, since a payee here can
 * be an unregistered name (payee_text) as well as a real vendor or customer.
 */
export function PartySelect({
  parties, value, text, onPick, onTextChange, placeholder = 'Search vendor or customer…',
  disabled, className, id,
}: PartySelectProps) {
  const [open, setOpen] = React.useState(false);
  const [menuPosition, setMenuPosition] = React.useState({ top: 0, left: 0, width: 0 });
  const [activeIdx, setActiveIdx] = React.useState(0);
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);

  const selected = parties.find(p => p.id === value) ?? null;
  const displayValue = selected ? selected.name : text;

  const filtered = React.useMemo(() => {
    const q = displayValue.trim().toLowerCase();
    if (!q) return parties;
    return parties.filter(p => p.name.toLowerCase().includes(q));
  }, [parties, displayValue]);

  React.useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (
        wrapperRef.current && !wrapperRef.current.contains(target) &&
        menuRef.current && !menuRef.current.contains(target)
      ) setOpen(false);
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  React.useEffect(() => { setActiveIdx(0); }, [displayValue]);

  React.useEffect(() => {
    if (!open || !listRef.current) return;
    const item = listRef.current.children[activeIdx] as HTMLElement | undefined;
    item?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIdx, open]);

  function openMenu() {
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (rect) setMenuPosition({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    setOpen(true);
  }

  function pick(p: Party) {
    onPick(p);
    setOpen(false);
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActiveIdx(i => Math.min(i + 1, Math.max(filtered.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      const p = filtered[activeIdx];
      if (open && p) { e.preventDefault(); pick(p); }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  const menu = open && !disabled
    ? createPortal(
        <div
          ref={menuRef}
          style={{ position: 'fixed', top: menuPosition.top, left: menuPosition.left, width: menuPosition.width, zIndex: 9999 }}
          className="overflow-hidden rounded-md border bg-background shadow-md"
        >
          <div className="max-h-72 overflow-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">No matching vendor or customer — will be saved as typed</div>
            ) : (
              <ul ref={listRef} role="listbox" className="py-1">
                {filtered.map((p, i) => (
                  <li
                    key={`${p.type}-${p.id}`}
                    role="option"
                    aria-selected={i === activeIdx}
                    onMouseDown={e => { e.preventDefault(); pick(p); }}
                    onMouseEnter={() => setActiveIdx(i)}
                    className={cn(
                      'flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm',
                      i === activeIdx && 'bg-accent text-accent-foreground',
                    )}
                  >
                    <span className="truncate">{p.name}</span>
                    <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">{p.type}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <div ref={wrapperRef} className={cn('relative', className)}>
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        autoComplete="off"
        disabled={disabled}
        value={displayValue}
        placeholder={placeholder}
        onChange={e => { onTextChange(e.target.value); setOpen(true); }}
        onFocus={openMenu}
        onKeyDown={onKey}
        className={cn(
          'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background',
          'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
      />
      {menu}
    </div>
  );
}
