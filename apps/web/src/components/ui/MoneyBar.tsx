import { fmtMoney } from '@/lib/money';

export type MoneyBarSegment = {
  amount: number;
  caption: string;
  colorClass: string;
};

// QBO-style money bar: stat blocks above a proportional segmented color bar.
export function MoneyBar({ segments }: { segments: MoneyBarSegment[] }) {
  const total = segments.reduce((s, x) => s + Math.abs(x.amount), 0);
  return (
    <div className="space-y-3">
      <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${segments.length}, minmax(0, 1fr))` }}>
        {segments.map(s => (
          <div key={s.caption}>
            <div className="text-xl font-semibold">{fmtMoney(String(s.amount))}</div>
            <div className="text-sm text-muted-foreground">{s.caption}</div>
          </div>
        ))}
      </div>
      <div className="flex h-4 w-full overflow-hidden rounded-sm">
        {segments.map(s => (
          <div
            key={s.caption}
            className={s.colorClass}
            style={{ flexGrow: total === 0 ? 1 : Math.max(Math.abs(s.amount), total * 0.04), flexBasis: 0 }}
          />
        ))}
      </div>
    </div>
  );
}
