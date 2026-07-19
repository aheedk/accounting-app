import { useCallback, useEffect, useState } from 'react';
import { DateInput } from '@/components/ui/date-input';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { fmtMoney, parseMoneyInput } from '@/lib/money';
import { FileDown, Printer } from 'lucide-react';
import { downloadAsExcel } from '@/lib/download';
import { todayLocal } from '@/lib/dates';
import { pickErr } from '@/lib/apiErrors';

type Period = 'monthly' | 'quarterly' | 'annual';
type Status = 'accrued' | 'paid';

type PayrollTaxLiability = {
  id: string;
  period: Period;
  period_start: string;
  period_end: string;
  liability_account_id: string;
  amount: string;
  status: Status;
  paid_at: string | null;
  payment_journal_entry_id: string | null;
  notes: string | null;
};

type Account = {
  id: string;
  code: string;
  name: string;
  account_type: string;
  is_active: boolean;
};


function statusBadge(status: Status) {
  const base = 'inline-flex rounded-full px-2 py-0.5 text-xs font-medium';
  if (status === 'accrued') return <span className={`${base} bg-amber-100 text-amber-800`}>Accrued</span>;
  return <span className={`${base} bg-emerald-100 text-emerald-800`}>Paid</span>;
}

function fmtShortDate(iso: string) {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${Number(m)}/${Number(d)}/${y.slice(2)}`;
}

export default function PayrollTaxesPage() {
  const [bizId] = useActiveBusinessId();
  const today = todayLocal();

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [liabilities, setLiabilities] = useState<PayrollTaxLiability[]>([]);
  const [filter, setFilter] = useState<Status | 'all'>('all');
  const [err, setErr] = useState<string | null>(null);

  // Record-liability form state
  const [form, setForm] = useState({
    period: 'monthly' as Period,
    period_start: today,
    period_end: today,
    liability_account_id: '',
    amount: '0.00',
    notes: '',
  });
  const [createBusy, setCreateBusy] = useState(false);
  const [excelBusy, setExcelBusy] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);

  // Pay dialog state
  const [payTarget, setPayTarget] = useState<PayrollTaxLiability | null>(null);
  const [payCashAccountId, setPayCashAccountId] = useState('');
  const [payDate, setPayDate] = useState(today);
  const [payBusy, setPayBusy] = useState(false);
  const [payErr, setPayErr] = useState<string | null>(null);

  const loadAccounts = useCallback(async () => {
    if (!bizId) return;
    try {
      const r = await api.get<{ accounts: Account[] }>(`/businesses/${bizId}/coa`);
      setAccounts(r.data.accounts);
    } catch (e: unknown) {
      setErr(pickErr(e));
    }
  }, [bizId]);

  const loadLiabilities = useCallback(async () => {
    if (!bizId) return;
    try {
      const params: { status?: Status } = {};
      if (filter !== 'all') params.status = filter;
      const r = await api.get<{ liabilities: PayrollTaxLiability[] }>(
        `/businesses/${bizId}/payroll-tax-liabilities`,
        { params },
      );
      setLiabilities(r.data.liabilities);
    } catch (e: unknown) {
      setErr(pickErr(e));
    }
  }, [bizId, filter]);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  useEffect(() => {
    void loadLiabilities();
  }, [loadLiabilities]);

  const liabilityAccounts = accounts.filter(a => a.account_type === 'liability' && a.is_active);
  // Cash accounts: assets with code starting with 10 (matches PaymentNewPage convention).
  const cashAccounts = accounts.filter(
    a => a.account_type === 'asset' && a.is_active && a.code.startsWith('10'),
  );

  function accountLabel(id: string): string {
    const a = accounts.find(x => x.id === id);
    return a ? `${a.code} — ${a.name}` : id.slice(0, 8);
  }

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!bizId) return;
    setCreateBusy(true);
    setCreateErr(null);
    try {
      const body = {
        period: form.period,
        period_start: form.period_start,
        period_end: form.period_end,
        liability_account_id: form.liability_account_id,
        amount: parseMoneyInput(form.amount),
        notes: form.notes.trim() ? form.notes.trim() : null,
      };
      await api.post(`/businesses/${bizId}/payroll-tax-liabilities`, body);
      setForm({
        period: 'monthly',
        period_start: today,
        period_end: today,
        liability_account_id: '',
        amount: '0.00',
        notes: '',
      });
      await loadLiabilities();
    } catch (e: unknown) {
      setCreateErr(pickErr(e));
    } finally {
      setCreateBusy(false);
    }
  }

  function openPay(liability: PayrollTaxLiability) {
    setPayTarget(liability);
    setPayCashAccountId('');
    setPayDate(today);
    setPayErr(null);
  }

  function closePay() {
    setPayTarget(null);
    setPayBusy(false);
    setPayErr(null);
  }

  async function submitPay(e: React.FormEvent) {
    e.preventDefault();
    if (!bizId || !payTarget) return;
    setPayBusy(true);
    setPayErr(null);
    try {
      await api.post(`/businesses/${bizId}/payroll-tax-liabilities/${payTarget.id}/pay`, {
        cash_account_id: payCashAccountId,
        payment_date: payDate,
      });
      closePay();
      await loadLiabilities();
    } catch (e: unknown) {
      setPayErr(pickErr(e));
    } finally {
      setPayBusy(false);
    }
  }

  if (!bizId) return <div>Pick a business.</div>;

  const dlHeaders = ['Period', 'Start', 'End', 'Amount', 'Status', 'Notes'];
  const dlRows = () => liabilities.map(l => [l.period, l.period_start, l.period_end, l.amount, l.status, l.notes ?? '']);

  function handleExport() {
    setExcelBusy(true);
    try { downloadAsExcel(dlHeaders, dlRows(), 'payroll-taxes'); } finally { setExcelBusy(false); }
  }

  function handlePrint() {
    const rowsHtml = dlRows().map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('');
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><title>Payroll Taxes</title><style>body{font-family:Arial,sans-serif;font-size:11px;margin:24px}h2{margin-bottom:4px}p{color:#666;font-size:10px;margin-bottom:16px}table{width:100%;border-collapse:collapse}th{background:#f0f0f0;text-align:left;padding:5px 7px;border-bottom:2px solid #ccc;font-size:10px;text-transform:uppercase}td{padding:4px 7px;border-bottom:1px solid #e5e5e5}</style></head><body><h2>Payroll Tax Liabilities</h2><p>Generated ${new Date().toLocaleDateString()}</p><table><thead><tr>${dlHeaders.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rowsHtml}</tbody></table><script>window.onload=function(){window.print()}<\/script></body></html>`);
    win.document.close();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Payroll Taxes</h1>
        <div className="flex items-center gap-2">
          <div className="relative group">
            <button className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50" onClick={handleExport} disabled={excelBusy} aria-label="Export to Excel">
              <FileDown className="h-4 w-4" />
            </button>
            <div className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">Export to Excel</div>
          </div>
          <div className="relative group">
            <button className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground" onClick={handlePrint} aria-label="Print">
              <Printer className="h-4 w-4" />
            </button>
            <div className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">Print</div>
          </div>
        </div>
      </div>

      {err && <p className="text-sm text-destructive">{err}</p>}

      <Card>
        <CardHeader><CardTitle>Record liability</CardTitle></CardHeader>
        <CardContent>
          <form className="grid grid-cols-1 sm:grid-cols-2 gap-3" onSubmit={submitCreate}>
            <div>
              <Label>Period</Label>
              <select
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={form.period}
                onChange={e => setForm(f => ({ ...f, period: e.target.value as Period }))}
              >
                <option value="monthly">monthly</option>
                <option value="quarterly">quarterly</option>
                <option value="annual">annual</option>
              </select>
            </div>
            <div>
              <Label>Liability account</Label>
              <select
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={form.liability_account_id}
                onChange={e => setForm(f => ({ ...f, liability_account_id: e.target.value }))}
                required
              >
                <option value="">Select…</option>
                {liabilityAccounts.map(a => (
                  <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                ))}
              </select>
            </div>
            <div>
              <Label>Period start</Label>
              <DateInput
                value={form.period_start}
                onChange={e => setForm(f => ({ ...f, period_start: e.target.value }))}
                required
              />
            </div>
            <div>
              <Label>Period end</Label>
              <DateInput
                value={form.period_end}
                onChange={e => setForm(f => ({ ...f, period_end: e.target.value }))}
                required
              />
            </div>
            <div>
              <Label>Amount</Label>
              <Input
                type="number"
                step="0.01"
                value={form.amount}
                onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                required
              />
            </div>
            <div className="sm:col-span-2">
              <Label>Notes</Label>
              <Input
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              />
            </div>
            {createErr && <p className="sm:col-span-2 text-sm text-destructive">{createErr}</p>}
            <div className="sm:col-span-2 flex justify-end">
              <Button type="submit" disabled={createBusy}>
                {createBusy ? 'Recording…' : '+ Record liability'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Liabilities</CardTitle>
            <select
              className="h-9 rounded-md border bg-background px-3 text-sm"
              value={filter}
              onChange={e => setFilter(e.target.value as Status | 'all')}
            >
              <option value="all">All</option>
              <option value="accrued">Accrued</option>
              <option value="paid">Paid</option>
            </select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40">
              <tr className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <th className="text-left p-3">Period</th>
                <th className="text-left p-3">Date Range</th>
                <th className="text-left p-3">Liability Account</th>
                <th className="text-right p-3">Amount</th>
                <th className="text-left p-3">Status</th>
                <th className="text-right p-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {liabilities.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-sm text-muted-foreground">
                    No liabilities yet.
                  </td>
                </tr>
              )}
              {liabilities.map(l => (
                <tr key={l.id} className="border-b last:border-b-0 hover:bg-muted/30">
                  <td className="p-3 capitalize">{l.period}</td>
                  <td className="p-3 font-mono text-xs whitespace-nowrap">{fmtShortDate(l.period_start)} → {fmtShortDate(l.period_end)}</td>
                  <td className="p-3">{accountLabel(l.liability_account_id)}</td>
                  <td className="p-3 text-right font-mono">{fmtMoney(l.amount)}</td>
                  <td className="p-3">{statusBadge(l.status)}</td>
                  <td className="p-3 text-right">
                    {l.status === 'accrued' ? (
                      <Button size="sm" variant="outline" onClick={() => openPay(l)}>Pay…</Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {l.paid_at ? new Date(l.paid_at).toLocaleDateString() : '—'}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Dialog open={!!payTarget} onOpenChange={(open) => { if (!open) closePay(); }}>
        {payTarget && (
          <DialogContent>
            <DialogHeader><DialogTitle>Pay liability</DialogTitle></DialogHeader>
            <div className="p-6">
              <form className="space-y-3" onSubmit={submitPay}>
                <p className="text-sm text-muted-foreground">
                  <span className="capitalize">{payTarget.period}</span> · {fmtShortDate(payTarget.period_start)} → {fmtShortDate(payTarget.period_end)} ·{' '}
                  <span className="font-mono">{fmtMoney(payTarget.amount)}</span>
                </p>
                <div>
                  <Label htmlFor="pay-cash-account">Cash account</Label>
                  <select
                    id="pay-cash-account"
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                    value={payCashAccountId}
                    onChange={e => setPayCashAccountId(e.target.value)}
                    required
                  >
                    <option value="">Select…</option>
                    {cashAccounts.map(a => (
                      <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="pay-date">Payment date</Label>
                  <DateInput
                    id="pay-date"
                    value={payDate}
                    onChange={e => setPayDate(e.target.value)}
                    required
                  />
                </div>
                {payErr && <p className="text-sm text-destructive">{payErr}</p>}
                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="ghost" onClick={closePay} disabled={payBusy}>Cancel</Button>
                  <Button type="submit" disabled={payBusy}>{payBusy ? 'Paying…' : 'Pay'}</Button>
                </div>
              </form>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
