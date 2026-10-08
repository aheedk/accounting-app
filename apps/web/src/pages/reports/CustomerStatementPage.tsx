import { useEffect, useState } from 'react';
import { FileDown, Printer } from 'lucide-react';
import { DateInput } from '@/components/ui/date-input';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { AppSelect } from '../../components/ui/select';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { pickErr } from '@/lib/apiErrors';
import { currentYearLocal, fmtLongDate, todayLocal } from '@/lib/dates';
import { downloadAsExcel } from '@/lib/download';
import { fmtMoney } from '@/lib/money';
import { printReport } from '@/lib/reportExport';

type Customer = { id: string; name: string };
type Line = { date: string; type: 'invoice' | 'payment' | 'credit_memo'; number: string | null; charge: string; credit: string; balance: string };
type Statement = {
  customer: Customer;
  period_start: string;
  period_end: string;
  opening_balance: string;
  lines: Line[];
  closing_balance: string;
};

const TYPE_LABELS: Record<Line['type'], string> = { invoice: 'Invoice', payment: 'Payment', credit_memo: 'Credit memo' };
const blankIfZero = (v: string) => (Number(v) === 0 ? '' : fmtMoney(v));

// One customer's account for a period: what they were billed, what they paid
// and were credited, and the balance after each. The page a business prints
// and sends to its customer.
export default function CustomerStatementPage() {
  const [bizId] = useActiveBusinessId();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [from, setFrom] = useState(`${currentYearLocal()}-01-01`);
  const [to, setTo] = useState(todayLocal());
  const [statement, setStatement] = useState<Statement | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!bizId) return;
    api.get<{ customers: Customer[] }>(`/businesses/${bizId}/customers?include_inactive=true`)
      .then(r => setCustomers(r.data.customers))
      .catch((e: unknown) => setErr(pickErr(e)));
  }, [bizId]);

  useEffect(() => {
    if (!bizId || !customerId || !from || !to) { setStatement(null); return; }
    let live = true;
    api.get<Statement>(`/businesses/${bizId}/reports/customer-statement`, { params: { customer_id: customerId, period_start: from, period_end: to } })
      .then(r => { if (live) { setStatement(r.data); setErr(null); } })
      .catch((e: unknown) => { if (live) { setStatement(null); setErr(pickErr(e)); } });
    return () => { live = false; };
  }, [bizId, customerId, from, to]);

  const headers = ['Date', 'Type', 'No.', 'Charge', 'Payment or credit', 'Balance'];
  const rows = (s: Statement): string[][] => [
    [fmtLongDate(s.period_start), 'Balance forward', '', '', '', fmtMoney(s.opening_balance)],
    ...s.lines.map(l => [fmtLongDate(l.date), TYPE_LABELS[l.type], l.number ?? '', blankIfZero(l.charge), blankIfZero(l.credit), fmtMoney(l.balance)]),
    [fmtLongDate(s.period_end), 'Amount due', '', '', '', fmtMoney(s.closing_balance)],
  ];
  const subtitle = (s: Statement) => `${s.customer.name} · ${fmtLongDate(s.period_start)} to ${fmtLongDate(s.period_end)}`;

  if (!bizId) return <div>Pick a business.</div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Customer Statement</h1>
          <p className="mt-1 text-sm text-muted-foreground">What a customer was billed and paid in a period, and what they owe.</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label>Customer</Label>
            <AppSelect className="h-10 w-56 rounded-md border bg-background px-3 text-sm" value={customerId} onChange={e => setCustomerId(e.target.value)}>
              <option value="">Choose a customer…</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </AppSelect>
          </div>
          <div><Label>From</Label><DateInput value={from} onChange={e => setFrom(e.target.value)} /></div>
          <div><Label>To</Label><DateInput value={to} onChange={e => setTo(e.target.value)} /></div>
          <button
            className="inline-flex h-10 w-10 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
            disabled={!statement} aria-label="Export to Excel" title="Export to Excel"
            onClick={() => statement && downloadAsExcel(headers, rows(statement), 'customer-statement', { title: 'Statement', subtitle: subtitle(statement) })}
          >
            <FileDown className="h-4 w-4" />
          </button>
          <button
            className="inline-flex h-10 w-10 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
            disabled={!statement} aria-label="Print" title="Print"
            onClick={() => statement && printReport({ title: 'Statement', subtitle: subtitle(statement), headers, rows: rows(statement) })}
          >
            <Printer className="h-4 w-4" />
          </button>
        </div>
      </div>

      {err && <p className="text-sm text-destructive">{err}</p>}

      {!statement ? (
        <Card><CardContent className="p-10 text-center text-sm text-muted-foreground">Choose a customer to see their statement.</CardContent></Card>
      ) : (
        <Card><CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40">
              <tr className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <th className="p-3 text-left">Date</th>
                <th className="p-3 text-left">Type</th>
                <th className="p-3 text-left">No.</th>
                <th className="p-3 text-right">Charge</th>
                <th className="p-3 text-right">Payment or credit</th>
                <th className="p-3 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b bg-muted/20">
                <td className="p-3 whitespace-nowrap">{fmtLongDate(statement.period_start)}</td>
                <td className="p-3" colSpan={4}>Balance forward</td>
                <td className="p-3 text-right font-mono">{fmtMoney(statement.opening_balance)}</td>
              </tr>
              {statement.lines.map((l, i) => (
                <tr key={`${l.type}-${l.date}-${i}`} className="border-b">
                  <td className="p-3 whitespace-nowrap">{fmtLongDate(l.date)}</td>
                  <td className="p-3">{TYPE_LABELS[l.type]}</td>
                  <td className="p-3 font-mono">{l.number ?? '—'}</td>
                  <td className="p-3 text-right font-mono">{blankIfZero(l.charge)}</td>
                  <td className="p-3 text-right font-mono">{blankIfZero(l.credit)}</td>
                  <td className="p-3 text-right font-mono">{fmtMoney(l.balance)}</td>
                </tr>
              ))}
              {statement.lines.length === 0 && (
                <tr className="border-b"><td colSpan={6} className="p-6 text-center text-muted-foreground">Nothing was billed or paid in this period.</td></tr>
              )}
              <tr className="font-semibold">
                <td className="p-3" colSpan={5}>Amount due as of {fmtLongDate(statement.period_end)}</td>
                <td className="p-3 text-right font-mono">{fmtMoney(statement.closing_balance)}</td>
              </tr>
            </tbody>
          </table>
        </CardContent></Card>
      )}
    </div>
  );
}
