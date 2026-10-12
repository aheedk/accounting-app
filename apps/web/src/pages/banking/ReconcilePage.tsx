import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { hideUnless, useCan } from '@/lib/roleAccess';
import { History } from 'lucide-react';
import { DateInput } from '@/components/ui/date-input';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { MoneyInput } from '@/components/ui/money-input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fmtMoney, parseMoneyInput } from '@/lib/money';
import { todayLocal } from '@/lib/dates';
import { pickErr } from '@/lib/apiErrors';
import { AppSelect } from '../../components/ui/select';

type ReconcilableAccount = { id: string; code: string; name: string; category: string };

type CoaAccount = { id: string; code: string; name: string; account_type: string };

export default function ReconcilePage() {
  // Starting a reconciliation is for an accountant — same bar as finishing one.
  const can = useCan();
  const navigate = useNavigate();
  const [bizId] = useActiveBusinessId();
  const today = todayLocal();

  const [reconcilableAccounts, setReconcilableAccounts] = useState<ReconcilableAccount[]>([]);
  const [accountId, setAccountId] = useState<string>('');
  const [accounts, setAccounts] = useState<CoaAccount[]>([]);

  const [beginningBalance, setBeginningBalance] = useState('0.00');
  const [inProgressId, setInProgressId] = useState<string | null>(null);

  const [form, setForm] = useState({
    statement_ending_balance: '0.00',
    statement_ending_date: today,
    service_charge_amount: '',
    service_charge_date: today,
    service_charge_account_id: '',
    interest_earned_amount: '',
    interest_earned_date: today,
    interest_earned_account_id: '',
  });

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!bizId) return;
    api.get(`/businesses/${bizId}/bank-rec/accounts`).then(r => {
      const list: ReconcilableAccount[] = r.data.accounts;
      setReconcilableAccounts(list);
      setAccountId(prev => prev && list.some(a => a.id === prev) ? prev : (list[0]?.id ?? ''));
    }).catch((e: unknown) => setErr(pickErr(e)));
    api.get(`/businesses/${bizId}/coa`).then(r => setAccounts(r.data.accounts)).catch(() => {});
  }, [bizId]);

  useEffect(() => {
    if (!bizId || !accountId) { setBeginningBalance('0.00'); setInProgressId(null); return; }
    setErr(null);
    api.get(`/businesses/${bizId}/bank-rec/status`, { params: { account_id: accountId } })
      .then(r => { setBeginningBalance(r.data.beginning_balance); setInProgressId(r.data.in_progress_id); })
      .catch((e: unknown) => setErr(pickErr(e)));
  }, [bizId, accountId]);

  const expenseAccounts = accounts.filter(a => a.account_type === 'expense');
  const incomeAccounts = accounts.filter(a => a.account_type === 'revenue' || a.account_type === 'income');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!bizId || !accountId) return;
    setErr(null);
    setBusy(true);
    try {
      const body = {
        account_id: accountId,
        statement_ending_balance: parseMoneyInput(form.statement_ending_balance),
        statement_ending_date: form.statement_ending_date,
        service_charge_amount: form.service_charge_amount ? parseMoneyInput(form.service_charge_amount) : null,
        service_charge_date: form.service_charge_amount ? form.service_charge_date : null,
        service_charge_account_id: form.service_charge_amount ? (form.service_charge_account_id || null) : null,
        interest_earned_amount: form.interest_earned_amount ? parseMoneyInput(form.interest_earned_amount) : null,
        interest_earned_date: form.interest_earned_amount ? form.interest_earned_date : null,
        interest_earned_account_id: form.interest_earned_amount ? (form.interest_earned_account_id || null) : null,
      };
      const r = await api.post(`/businesses/${bizId}/bank-rec/start`, body);
      navigate(`/accounting/reconcile/${r.data.id}`);
    } catch (e: unknown) {
      setErr(pickErr(e));
    } finally {
      setBusy(false);
    }
  }

  if (!bizId) return <div>Pick a business.</div>;

  const needsServiceChargeAccount = !!form.service_charge_amount && !form.service_charge_account_id;
  const needsInterestAccount = !!form.interest_earned_amount && !form.interest_earned_account_id;
  const canSubmit = !busy && !!accountId && !!form.statement_ending_date && !needsServiceChargeAccount && !needsInterestAccount;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Reconcile</h1>
        <Button variant="outline" onClick={() => navigate('/accounting/reconcile/history')}>
          <History className="mr-2 h-4 w-4" />
          History by account
        </Button>
      </div>

      {err && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {err}
        </div>
      )}

      <Card>
        <CardHeader><CardTitle>Which account do you want to reconcile?</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Account</Label>
            <AppSelect
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={accountId}
              onChange={e => setAccountId(e.target.value)}
            >
              <option value="">Select…</option>
              {reconcilableAccounts.map(a => (
                <option key={a.id} value={a.id}>
                  {a.code} {a.name} — {a.category}
                </option>
              ))}
            </AppSelect>
          </div>

          {inProgressId && (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              A reconciliation is already in progress for this account.{' '}
              <button type="button" className="font-medium underline" onClick={() => navigate(`/accounting/reconcile/${inProgressId}`)}>
                Resume it
              </button>
              {' '}or finish/cancel it before starting a new one.
            </div>
          )}
        </CardContent>
      </Card>

      <form onSubmit={submit} className="space-y-6">
        <Card>
          <CardHeader><CardTitle>Add the following information</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-3 gap-4">
            <div>
              <Label>Beginning balance</Label>
              <div className="flex h-10 items-center rounded-md border bg-muted px-3 text-sm font-mono">
                {fmtMoney(beginningBalance)}
              </div>
            </div>
            <div>
              <Label>Statement ending balance</Label>
              <MoneyInput
                allowNegative value={form.statement_ending_balance}
                onChange={e => setForm(f => ({ ...f, statement_ending_balance: e.target.value }))}
                placeholder="0.00"
                required
              />
            </div>
            <div>
              <Label>Statement ending date</Label>
              <DateInput
                value={form.statement_ending_date}
                onChange={e => setForm(f => ({ ...f, statement_ending_date: e.target.value }))}
                required
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Service charge, if any</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-3 gap-4">
            <div>
              <Label>Date</Label>
              <DateInput
                value={form.service_charge_date}
                onChange={e => setForm(f => ({ ...f, service_charge_date: e.target.value }))}
              />
            </div>
            <div>
              <Label>Amount</Label>
              <MoneyInput
                value={form.service_charge_amount}
                onChange={e => setForm(f => ({ ...f, service_charge_amount: e.target.value }))}
                placeholder="0.00"
              />
            </div>
            <div>
              <Label>Expense account</Label>
              <AppSelect
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={form.service_charge_account_id}
                onChange={e => setForm(f => ({ ...f, service_charge_account_id: e.target.value }))}
              >
                <option value="">Select…</option>
                {expenseAccounts.map(a => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
              </AppSelect>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Interest earned, if any</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-3 gap-4">
            <div>
              <Label>Date</Label>
              <DateInput
                value={form.interest_earned_date}
                onChange={e => setForm(f => ({ ...f, interest_earned_date: e.target.value }))}
              />
            </div>
            <div>
              <Label>Amount</Label>
              <MoneyInput
                value={form.interest_earned_amount}
                onChange={e => setForm(f => ({ ...f, interest_earned_amount: e.target.value }))}
                placeholder="0.00"
              />
            </div>
            <div>
              <Label>Income account</Label>
              <AppSelect
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={form.interest_earned_account_id}
                onChange={e => setForm(f => ({ ...f, interest_earned_account_id: e.target.value }))}
              >
                <option value="">Select…</option>
                {incomeAccounts.map(a => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
              </AppSelect>
            </div>
          </CardContent>
        </Card>

        <div>
          <Button type="submit" {...hideUnless(can.accountant)} disabled={!canSubmit}>
            {busy ? 'Starting…' : 'Start reconciling'}
          </Button>
        </div>
      </form>
    </div>
  );
}
