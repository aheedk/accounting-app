import { useState, useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
import type { InputProps } from '@/components/ui/input';

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

  function sanitize(raw: string): string {
    if (!raw) return raw;
    const parts = raw.split('-');
    if (parts.length !== 3) return value; // malformed — reset
    const y = Math.min(Math.max(parseInt(parts[0]!, 10), 1000), 9999);
    const m = parseInt(parts[1]!, 10);
    const d = parseInt(parts[2]!, 10);
    const date = new Date(y, m - 1, d);
    // If month/day rolled over the date is invalid (e.g. June 31 → July 1)
    if (date.getMonth() !== m - 1 || date.getDate() !== d) return value;
    return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  return (
    <Input
      type="date"
      value={local}
      onFocus={() => { editing.current = true; }}
      onChange={e => setLocal(e.target.value)}
      onBlur={e => {
        editing.current = false;
        const clean = sanitize(e.target.value);
        setLocal(clean);
        fire(clean);
      }}
      {...props}
    />
  );
}
