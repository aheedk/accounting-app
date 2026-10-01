import { useState, useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
import type { InputProps } from '@/components/ui/input';
import { normalizeDateInput } from '@/lib/dates';

type Props = Omit<InputProps, 'type' | 'value' | 'onChange'> & {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
};

// Wraps <input type="date"> with local state so the browser's internal segment
// cursor isn't reset by React re-renders while the user is typing.
// Parent state is updated on blur (which fires before form submission).
export function DateInput({ value, onChange, ...props }: Props) {
  const [local, setLocal] = useState(value);
  const editing = useRef(false);
  const onChangeFn = useRef(onChange);
  useEffect(() => { onChangeFn.current = onChange; }, [onChange]);

  // Sync from parent only when not actively editing (e.g. external reset)
  useEffect(() => { if (!editing.current) setLocal(value); }, [value]);

  function fire(val: string) {
    onChangeFn.current({ target: { value: val } } as React.ChangeEvent<HTMLInputElement>);
  }

  function commit(raw: string) {
    const clean = normalizeDateInput(raw, value);
    setLocal(clean);
    fire(clean);
  }

  return (
    <Input
      type="date"
      value={local}
      onFocus={() => { editing.current = true; }}
      onChange={e => setLocal(e.target.value)}
      onBlur={e => {
        editing.current = false;
        commit(e.target.value);
      }}
      {...props}
      onKeyDown={e => {
        // Enter submits a form without a blur, so settle the date first.
        if (e.key === 'Enter') commit(e.currentTarget.value);
        props.onKeyDown?.(e);
      }}
    />
  );
}
