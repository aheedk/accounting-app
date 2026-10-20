import { statementBalanceGap, type BalanceLine } from '@accounting/shared';
import { DateInput } from '@/components/ui/date-input';
import { MoneyInput } from '@/components/ui/money-input';
import { fmtMoney } from '@/lib/money';
import type { SummaryForm } from '@/lib/statementSummary';

/**
 * The statement's own period and balances, read by the AI and kept for
 * Reconcile (item 72), with a check that the lines carry the beginning balance
 * to the ending one: a line the AI missed shows here.
 */
export function StatementSummaryFields({ kind, lines, value, onChange }: {
  kind: 'bank' | 'credit_card';
  lines: BalanceLine[];
  value: SummaryForm;
  onChange: (next: SummaryForm) => void;
}) {
  const gap = statementBalanceGap(kind, value.beginning_balance, value.ending_balance, lines);
  const field = (key: keyof SummaryForm) => (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...value, [key]: e.target.value });
  const labels = kind === 'credit_card'
    ? { start: 'Period from', end: 'Closing date', beginning: 'Previous balance', ending: 'New balance' }
    : { start: 'Period from', end: 'Period to', beginning: 'Beginning balance', ending: 'Ending balance' };
  return (
    <div className="rounded-lg border p-4 bg-muted/10 space-y-3">
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">{labels.start}</p>
          <DateInput aria-label={labels.start} value={value.period_start} onChange={field('period_start')} />
        </div>
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">{labels.end}</p>
          <DateInput aria-label={labels.end} value={value.period_end} onChange={field('period_end')} />
        </div>
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">{labels.beginning}</p>
          <MoneyInput aria-label={labels.beginning} allowNegative className="text-right"
            value={value.beginning_balance} onChange={field('beginning_balance')} />
        </div>
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">{labels.ending}</p>
          <MoneyInput aria-label={labels.ending} allowNegative className="text-right"
            value={value.ending_balance} onChange={field('ending_balance')} />
        </div>
      </div>
      {gap === null ? (
        <p className="text-xs text-muted-foreground">
          Type any balance the AI could not read from the PDF. They are kept with the statement, and Reconcile takes its
          ending balance and date from them.
        </p>
      ) : gap === '0.00' ? (
        <p className="text-xs text-emerald-700">
          The lines add up: the {labels.beginning.toLowerCase()} and these transactions come to the {labels.ending.toLowerCase()}.
        </p>
      ) : (
        <p className="text-xs text-amber-700">
          The lines are {fmtMoney(gap.replace(/^-/, ''))} off the {labels.ending.toLowerCase()}. A line may be missing or
          misread: compare them with the PDF before approving.
        </p>
      )}
    </div>
  );
}
