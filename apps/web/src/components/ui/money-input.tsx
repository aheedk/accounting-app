import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import type { InputProps } from '@/components/ui/input';
import { cleanMoneyInput, fmtMoneyInput, settleMoneyInput } from '@/lib/money';

type Props = Omit<InputProps, 'type' | 'value' | 'onChange'> & {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  /** Balances that can go below zero (an opening balance, a statement balance). */
  allowNegative?: boolean;
};

// An amount box. At rest it reads like the rest of the app ("9,000.00"); while
// typing it holds the plain number, and leaving it settles "9" to "9.00".
// The parent only ever sees a plain number string ("9000.00"), never commas,
// so totals and request bodies are built exactly as they were with a number input.
export function MoneyInput({ value, onChange, allowNegative = false, ...props }: Props) {
  // The text being typed; null while the box is not focused.
  const [draft, setDraft] = useState<string | null>(null);
  const edited = useRef(false);
  const lastFired = useRef(value);
  const onChangeFn = useRef(onChange);
  useEffect(() => { onChangeFn.current = onChange; }, [onChange]);

  // The form changed the amount itself while the box had focus (an autofill, a reset).
  useEffect(() => {
    if (value === lastFired.current) return;
    lastFired.current = value;
    setDraft(current => (current === null ? null : settleMoneyInput(value) || value));
  }, [value]);

  function fire(next: string) {
    lastFired.current = next;
    onChangeFn.current({ target: { value: next } } as React.ChangeEvent<HTMLInputElement>);
  }

  /** Untouched amounts are left exactly as loaded, so tabbing through changes nothing. */
  function settle(raw: string): string | null {
    if (!edited.current) return null;
    edited.current = false;
    const settled = settleMoneyInput(raw);
    if (settled !== value) fire(settled);
    return settled;
  }

  return (
    <Input
      inputMode="decimal"
      autoComplete="off"
      {...props}
      type="text"
      value={draft ?? fmtMoneyInput(value)}
      onFocus={e => {
        setDraft(settleMoneyInput(value) || value);
        props.onFocus?.(e);
      }}
      onChange={e => {
        const clean = cleanMoneyInput(e.target.value, allowNegative);
        edited.current = true;
        setDraft(clean);
        if (clean !== value) fire(clean);
      }}
      onBlur={e => {
        settle(e.target.value);
        setDraft(null);
        props.onBlur?.(e);
      }}
      onKeyDown={e => {
        // Enter submits a form without a blur, so settle the amount first.
        if (e.key === 'Enter') {
          const settled = settle(e.currentTarget.value);
          if (settled !== null) setDraft(settled);
        }
        props.onKeyDown?.(e);
      }}
    />
  );
}
