import { useState, useEffect, useRef } from 'react';
import { Calendar } from 'lucide-react';
import { Input } from '@/components/ui/input';
import type { InputProps } from '@/components/ui/input';
import { fmtDateText, parseDateText } from '@/lib/dates';
import { cn } from '@/lib/utils';

type Props = Omit<InputProps, 'type' | 'value' | 'onChange'> & {
  /** YYYY-MM-DD, or '' for no date. */
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
};

// Where the box sits (width, margins, its place in a flex row or grid) belongs
// to the wrapper; everything else in className styles the box itself.
const LAYOUT_CLASS = /^(-?m[trblxy]?-|w-|min-w-|max-w-|flex-|grow|shrink|basis-|col-span-|row-span-|self-|justify-self-|order-)/;

// A date box that is typed into as text (10/12/2026), the way QuickBooks does
// it: double-click or Ctrl+A selects the whole date, and typing over it
// replaces it. The browser's own date box selects one part at a time and has
// no "select all". The calendar is still there, behind the button.
//
// The parent only ever sees YYYY-MM-DD, and only once the date is settled (on
// leaving the box, on Enter, or on a pick from the calendar).
export function DateInput({ value, onChange, className, disabled, ...props }: Props) {
  const [local, setLocal] = useState(fmtDateText(value));
  const editing = useRef(false);
  const pickerRef = useRef<HTMLInputElement>(null);
  const onChangeFn = useRef(onChange);
  useEffect(() => { onChangeFn.current = onChange; }, [onChange]);

  // Sync from parent only when not actively editing (e.g. external reset)
  useEffect(() => { if (!editing.current) setLocal(fmtDateText(value)); }, [value]);

  function fire(val: string) {
    onChangeFn.current({ target: { value: val } } as React.ChangeEvent<HTMLInputElement>);
  }

  function commit(raw: string) {
    const clean = parseDateText(raw, value);
    setLocal(fmtDateText(clean));
    fire(clean);
  }

  function openCalendar() {
    const picker = pickerRef.current;
    if (!picker) return;
    // showPicker is missing in older browsers; focusing the field opens it there.
    try { picker.showPicker(); } catch { picker.focus(); }
  }

  const tokens = (className ?? '').split(/\s+/).filter(Boolean);
  const layout = tokens.filter(token => LAYOUT_CLASS.test(token.replace(/^[a-z-]+:/, '')));
  const look = tokens.filter(token => !layout.includes(token));

  return (
    <div className={cn('relative w-full', layout)}>
      <Input
        inputMode="numeric"
        autoComplete="off"
        placeholder="MM/DD/YYYY"
        {...props}
        type="text"
        data-date-input=""
        disabled={disabled}
        className={cn('w-full pr-9', look)}
        value={local}
        onFocus={e => {
          editing.current = true;
          props.onFocus?.(e);
        }}
        onChange={e => setLocal(e.target.value)}
        onDoubleClick={e => {
          // A double-click on its own would take only the month, day or year.
          e.currentTarget.select();
          props.onDoubleClick?.(e);
        }}
        onBlur={e => {
          editing.current = false;
          commit(e.target.value);
          props.onBlur?.(e);
        }}
        onKeyDown={e => {
          // Enter submits a form without a blur, so settle the date first.
          if (e.key === 'Enter') commit(e.currentTarget.value);
          props.onKeyDown?.(e);
        }}
      />
      {/* The browser's calendar, opened by the button. It takes no space and is skipped by Tab. */}
      <input
        ref={pickerRef}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        disabled={disabled}
        value={value}
        onChange={e => { if (e.target.value) commit(e.target.value); }}
        className="pointer-events-none absolute bottom-0 right-0 h-0 w-0 border-0 p-0 opacity-0"
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label="Open calendar"
        disabled={disabled}
        onClick={openCalendar}
        className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
      >
        <Calendar className="h-4 w-4" />
      </button>
    </div>
  );
}
