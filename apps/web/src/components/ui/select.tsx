import React, { useRef, useState, useEffect, useCallback } from 'react';
import { ChevronDown, Check } from 'lucide-react';
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
};

export function AppSelect({ value, onChange, className, disabled, children, ...rest }: AppSelectProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const options = parseOptions(children);
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
  }, [onChange]);

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

  useEffect(() => {
    if (open && listRef.current) {
      const active = listRef.current.querySelector('[data-selected="true"]') as HTMLElement | null;
      if (active) active.scrollIntoView({ block: 'nearest' });
    }
  }, [open]);

  return (
    <div
      ref={containerRef}
      className={cn('relative', className)}
      {...(rest as React.HTMLAttributes<HTMLDivElement>)}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen(prev => !prev)}
        className={cn(
          'flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm',
          'ring-offset-background transition-colors',
          'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
          'disabled:cursor-not-allowed disabled:opacity-50',
          open && 'ring-2 ring-ring ring-offset-2',
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate text-left">{displayLabel}</span>
        <ChevronDown
          className={cn('ml-2 h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && (
        <ul
          ref={listRef}
          role="listbox"
          className={cn(
            'absolute z-50 mt-1 max-h-72 w-full overflow-y-auto rounded-md border bg-white dark:bg-zinc-900 py-1 shadow-xl',
            'focus:outline-none',
          )}
          style={{ minWidth: '100%' }}
        >
          {options.map(opt => {
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
          {options.length === 0 && (
            <li className="px-3 py-2 text-sm text-muted-foreground">No options</li>
          )}
        </ul>
      )}
    </div>
  );
}
