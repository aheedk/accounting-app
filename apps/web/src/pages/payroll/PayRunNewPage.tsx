import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { pickErr } from '@/lib/apiErrors';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { DateInput } from '@/components/ui/date-input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/EmptyState';
import { AccountSelect } from '@/components/ui/AccountSelect';
import { fmtMoney } from '@/lib/money';
import { todayLocal } from '@/lib/dates';
import { flashMessage } from '@/lib/flash';
import { statementBankAccounts } from '@/lib/bankAccountOptions';
import { blankPayLine, netPay, payRunTotals, withHours, withPayrollTaxes, type PayLine } from './payRunMath';

type Employee = { id: string; full_name: string; default_pay_rate_cents: string; is_active: boolean };
type Account = { id: string; code: string; name: string; account_type: string; detail_type?: string | null; is_active: boolean };
type AccountKey = 'wages_expense' | 'payroll_tax_expense' | 'cash' | 'fed_tax_liability' | 'state_tax_liability' | 'fica_liability';

const TAX_COLUMNS: Array<{ key: keyof PayLine; label: string }> = [
  { key: 'federal_wh', label: 'Federal w/h' },
  { key: 'state_wh', label: 'State w/h' },
  { key: 'fica_employee', label: 'Soc. Sec.' },
  { key: 'medicare_employee', label: 'Medicare' },
  { key: 'other_deductions', label: 'Other' },
];

// Run payroll: one row per employee, taxes entered by hand (Social Security and
// Medicare are filled in from gross and can be typed over). Running it records
// the pay run and posts its journal entry.
export default function PayRunNewPage() {
  const [bizId] = useActiveBusinessId();
  const nav = useNavigate();
  const today = todayLocal();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [bankingIds, setBankingIds] = useState<ReadonlySet<string>>(new Set());
  const [lines, setLines] = useState<PayLine[]>([]);
  const [header, setHeader] = useState({ pay_period_start: `${today.slice(0, 8)}01`, pay_period_end: today, pay_date: today, memo: '' });
  const [chosen, setChosen] = useState<Record<AccountKey, string>>({
    wages_expense: '', payroll_tax_expense: '', cash: '', fed_tax_liability: '', state_tax_liability: '', fica_liability: '',
  });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!bizId) return;
    setLoading(true);
    Promise.all([
      api.get<{ employees: Employee[] }>(`/businesses/${bizId}/employees`),
      api.get<{ accounts: Account[] }>(`/businesses/${bizId}/coa`),
      api.get<{ bank_accounts: Array<{ cash_account_id: string }> }>(`/businesses/${bizId}/bank-accounts`)
        .then(r => r.data.bank_accounts ?? []).catch(() => []),
    ]).then(([empRes, coaRes, banks]) => {
      const active = empRes.data.employees.filter(e => e.is_active);
      const usable = coaRes.data.accounts.filter(a => a.is_active);
      const banking = new Set(banks.map(b => b.cash_account_id));
      setEmployees(active);
      setLines(active.map(e => blankPayLine(e.id)));
      setAccounts(usable);
      setBankingIds(banking);
      // Start from the accounts a chart usually has for payroll; every one can be changed.
      const named = (type: string, pattern: RegExp) => usable.find(a => a.account_type === type && pattern.test(a.name))?.id ?? '';
      const liability = named('liability', /payroll/i);
      const paidFrom = statementBankAccounts(usable, banking, '');
      setChosen({
        wages_expense: named('expense', /wage|salar/i),
        payroll_tax_expense: named('expense', /payroll tax/i) || named('expense', /wage|salar/i),
        cash: paidFrom.length === 1 ? paidFrom[0]!.id : (paidFrom.find(a => /operating|checking/i.test(a.name))?.id ?? ''),
        fed_tax_liability: liability,
        state_tax_liability: '',
        fica_liability: liability,
      });
    }).catch((e: unknown) => setErr(pickErr(e))).finally(() => setLoading(false));
  }, [bizId]);

  const totals = useMemo(() => payRunTotals(lines), [lines]);
  const byType = (type: string) => accounts.filter(a => a.account_type === type);
  const payFrom = useMemo(() => statementBankAccounts(accounts, bankingIds, chosen.cash), [accounts, bankingIds, chosen.cash]);
  const stateWithheld = lines.some(line => line.included && Number(line.state_wh) > 0);
  const accountsChosen = chosen.wages_expense && chosen.payroll_tax_expense && chosen.cash
    && chosen.fed_tax_liability && chosen.fica_liability && (!stateWithheld || chosen.state_tax_liability);
  const ready = totals.count > 0 && !totals.negativeNet && !!accountsChosen;

  function patchLine(employeeId: string, change: (line: PayLine) => PayLine) {
    setLines(prev => prev.map(line => (line.employee_id === employeeId ? change(line) : line)));
  }

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (!bizId || !ready) return;
    setErr(null); setBusy(true);
    try {
      const amount = (value: string) => (Number(value) || 0).toFixed(2);
      const created = await api.post<{ id: string }>(`/businesses/${bizId}/pay-runs`, {
        pay_period_start: header.pay_period_start,
        pay_period_end: header.pay_period_end,
        pay_date: header.pay_date,
        memo: header.memo.trim() || null,
        accounts: {
          wages_expense: chosen.wages_expense,
          payroll_tax_expense: chosen.payroll_tax_expense,
          cash: chosen.cash,
          fed_tax_liability: chosen.fed_tax_liability,
          fica_liability: chosen.fica_liability,
          ...(chosen.state_tax_liability ? { state_tax_liability: chosen.state_tax_liability } : {}),
        },
        lines: lines.filter(line => line.included && Number(line.gross) > 0).map(line => ({
          employee_id: line.employee_id,
          gross: amount(line.gross),
          federal_wh: amount(line.federal_wh),
          state_wh: amount(line.state_wh),
          fica_employee: amount(line.fica_employee),
          fica_employer: amount(line.fica_employer),
          medicare_employee: amount(line.medicare_employee),
          medicare_employer: amount(line.medicare_employer),
          other_deductions: amount(line.other_deductions),
        })),
      });
      // Saved first, then finalized. If finalizing fails the run stays as a draft on the Pay Runs list.
      await api.post(`/businesses/${bizId}/pay-runs/${created.data.id}/finalize`);
      flashMessage(`Payroll run for ${totals.count} employee${totals.count === 1 ? '' : 's'}`);
      nav('/payroll/pay-runs');
    } catch (e: unknown) {
      setErr(pickErr(e));
    } finally {
      setBusy(false);
    }
  }

  if (!bizId) return <div>Pick a business.</div>;
  if (!loading && employees.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">Run Payroll</h1>
        <EmptyState title="No active employees" hint="Add an employee before running payroll." actionLabel="Add employee" actionTo="/payroll/employees/new" />
      </div>
    );
  }

  const accountField = (key: AccountKey, label: string, options: Account[], required = true) => (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <AccountSelect
        accounts={options}
        value={chosen[key]}
        onChange={id => setChosen(c => ({ ...c, [key]: id }))}
        required={required}
        placeholder="Choose an account"
        ariaLabel={label}
      />
    </div>
  );

  return (
    <form className="space-y-6" onSubmit={run}>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Run Payroll</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Enter each employee&apos;s gross pay and what is withheld. Social Security (6.2%) and Medicare (1.45%) are
            filled in from gross; change them if they differ.
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Net pay</div>
          <div className="text-3xl font-semibold font-mono">{fmtMoney(String(totals.net))}</div>
        </div>
      </div>

      <Card><CardContent className="grid grid-cols-1 gap-3 pt-6 md:grid-cols-4">
        <div>
          <Label className="text-xs text-muted-foreground">Pay period start</Label>
          <DateInput value={header.pay_period_start} onChange={e => setHeader(h => ({ ...h, pay_period_start: e.target.value }))} required />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Pay period end</Label>
          <DateInput value={header.pay_period_end} onChange={e => setHeader(h => ({ ...h, pay_period_end: e.target.value }))} required />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Pay date</Label>
          <DateInput value={header.pay_date} onChange={e => setHeader(h => ({ ...h, pay_date: e.target.value }))} required />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Memo (optional)</Label>
          <Input value={header.memo} onChange={e => setHeader(h => ({ ...h, memo: e.target.value }))} />
        </div>
      </CardContent></Card>

      <Card><CardContent className="p-0">
        <div className="w-full overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="border-b">
              <tr className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <th className="w-10 p-3 text-left"></th>
                <th className="p-3 text-left">Employee</th>
                <th className="p-3 text-right">Hours</th>
                <th className="p-3 text-right">Gross pay</th>
                {TAX_COLUMNS.map(col => <th key={col.key} className="p-3 text-right">{col.label}</th>)}
                <th className="p-3 text-right">Net pay</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={10} className="p-6 text-center text-muted-foreground">Loading…</td></tr>}
              {lines.map(line => {
                const employee = employees.find(e => e.id === line.employee_id);
                if (!employee) return null;
                const rate = Number(employee.default_pay_rate_cents) / 100;
                const net = netPay(line);
                return (
                  <tr key={line.employee_id} className={`border-b last:border-b-0 ${line.included ? '' : 'opacity-40'}`}>
                    <td className="p-3">
                      <input
                        type="checkbox" checked={line.included} aria-label={`Pay ${employee.full_name}`}
                        onChange={e => patchLine(line.employee_id, l => ({ ...l, included: e.target.checked }))}
                      />
                    </td>
                    <td className="p-3">
                      <div className="font-medium">{employee.full_name}</div>
                      {rate > 0 && <div className="text-xs text-muted-foreground">{fmtMoney(String(rate))} an hour</div>}
                    </td>
                    <td className="p-2">
                      <Input
                        className="ml-auto h-9 w-20 text-right font-mono" inputMode="decimal" disabled={!line.included}
                        value={line.hours} aria-label={`Hours for ${employee.full_name}`}
                        onChange={e => patchLine(line.employee_id, l => withHours(l, e.target.value.replace(/[^0-9.]/g, ''), rate))}
                      />
                    </td>
                    <td className="p-2">
                      <MoneyInput
                        className="ml-auto h-9 w-28 text-right font-mono" disabled={!line.included} placeholder="0.00"
                        value={line.gross} aria-label={`Gross pay for ${employee.full_name}`}
                        onChange={e => patchLine(line.employee_id, l => withPayrollTaxes(l, e.target.value))}
                      />
                    </td>
                    {TAX_COLUMNS.map(col => (
                      <td key={col.key} className="p-2">
                        <MoneyInput
                          className="ml-auto h-9 w-24 text-right font-mono" disabled={!line.included} placeholder="0.00"
                          value={String(line[col.key])} aria-label={`${col.label} for ${employee.full_name}`}
                          onChange={e => patchLine(line.employee_id, l => (
                            // The employer matches what the employee pays in Social Security and Medicare.
                            col.key === 'fica_employee' ? { ...l, fica_employee: e.target.value, fica_employer: e.target.value }
                              : col.key === 'medicare_employee' ? { ...l, medicare_employee: e.target.value, medicare_employer: e.target.value }
                                : { ...l, [col.key]: e.target.value }
                          ))}
                        />
                      </td>
                    ))}
                    <td className={`p-3 text-right font-mono font-medium ${net < 0 ? 'text-destructive' : ''}`}>{fmtMoney(String(net))}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t font-semibold">
                <td className="p-3" colSpan={3}>{totals.count} employee{totals.count === 1 ? '' : 's'}</td>
                <td className="p-3 text-right font-mono">{fmtMoney(String(totals.gross))}</td>
                <td className="p-3 text-right text-xs font-normal text-muted-foreground" colSpan={TAX_COLUMNS.length}>
                  Employer taxes {fmtMoney(String(totals.employerTaxes))}
                </td>
                <td className="p-3 text-right font-mono">{fmtMoney(String(totals.net))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </CardContent></Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Accounts</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {accountField('cash', 'Paid from', payFrom)}
          {accountField('wages_expense', 'Wages expense', byType('expense'))}
          {accountField('payroll_tax_expense', 'Employer payroll tax expense', byType('expense'))}
          {accountField('fed_tax_liability', 'Federal withholding owed', byType('liability'))}
          {accountField('fica_liability', 'Social Security and Medicare owed', byType('liability'))}
          {accountField('state_tax_liability', `State withholding owed${stateWithheld ? '' : ' (optional)'}`, byType('liability'), stateWithheld)}
        </CardContent>
      </Card>

      {totals.negativeNet && <p className="text-sm text-destructive">An employee has more withheld than they are paid.</p>}
      {err && <p className="text-sm text-destructive">{err}</p>}
      <div className="flex items-center gap-2 sticky -bottom-4 z-10 lg:-bottom-6 border-t bg-background py-3">
        <Button type="button" variant="outline" onClick={() => nav('/payroll/pay-runs')}>Cancel</Button>
        <div className="flex-1" />
        <Button type="submit" disabled={busy || !ready}>{busy ? 'Running…' : 'Run payroll'}</Button>
      </div>
    </form>
  );
}
