import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Upload } from 'lucide-react';
import { hideUnless, useCan } from '@/lib/roleAccess';
import { DateInput } from '@/components/ui/date-input';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { MoneyInput } from '@/components/ui/money-input';
import { Label } from '@/components/ui/label';
import { fmtMoney, parseMoneyInput } from '@/lib/money';
import { todayLocal } from '@/lib/dates';
import { pickErr } from '@/lib/apiErrors';
import { AppSelect } from '../../components/ui/select';
import { ReconcileNav } from './ReconcileNav';
import { LoadingIndicator } from '@/components/ui/LoadingIndicator';
import DocumentUpload, { type UploadResult } from '@/pages/ai/DocumentUpload';
import { ReconcileStatementReview } from './ReconcileStatementReview';

type ReconcilableAccount = { id: string; code: string; name: string; category: string };

type CoaAccount = { id: string; code: string; name: string; account_type: string };

type StatementBalance = {
  id: string;
  period_start: string | null;
  period_end: string | null;
  beginning_balance: string | null;
  ending_balance: string | null;
  approved_at: string | null;
};

function fmtShortDate(iso: string) {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${Number(m)}/${Number(d)}/${y.slice(2)}`;
}

export default function ReconcilePage() {
  // Starting a reconciliation is for an accountant — same bar as finishing one.
  const can = useCan();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [bizId] = useActiveBusinessId();
  const today = todayLocal();
  const preselectedAccountId = searchParams.get('accountId');

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

  const [uploadOpen, setUploadOpen] = useState(false);
  const [stagedId, setStagedId] = useState<string | null>(null);
  const [appliedNote, setAppliedNote] = useState<string | null>(null);
  const [latestStatement, setLatestStatement] = useState<StatementBalance | null>(null);

  useEffect(() => {
    if (!bizId) return;
    api.get(`/businesses/${bizId}/bank-rec/accounts`).then(r => {
      const list: ReconcilableAccount[] = r.data.accounts;
      setReconcilableAccounts(list);
      setAccountId(prev => {
        if (prev && list.some(a => a.id === prev)) return prev;
        if (preselectedAccountId && list.some(a => a.id === preselectedAccountId)) return preselectedAccountId;
        return list[0]?.id ?? '';
      });
    }).catch((e: unknown) => setErr(pickErr(e)));
    api.get(`/businesses/${bizId}/coa`).then(r => setAccounts(r.data.accounts)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only applied once, when the account list first loads
  }, [bizId]);

  useEffect(() => {
    if (!bizId || !accountId) { setBeginningBalance('0.00'); setInProgressId(null); return; }
    setErr(null);
    api.get(`/businesses/${bizId}/bank-rec/status`, { params: { account_id: accountId } })
      .then(r => { setBeginningBalance(r.data.beginning_balance); setInProgressId(r.data.in_progress_id); })
      .catch((e: unknown) => setErr(pickErr(e)));
  }, [bizId, accountId]);

  // Item 72's still-open piece: offer to fill the ending balance/date from an
  // already-approved statement for this account, instead of only typing them.
  // Never overwrites what's already in the form — just offers a one-click fill.
  useEffect(() => {
    setLatestStatement(null);
    if (!bizId || !accountId) return;
    api.get<{ statements: StatementBalance[] }>(`/businesses/${bizId}/email-imports/statement-balances`, { params: { account_id: accountId } })
      .then(r => setLatestStatement(r.data.statements[0] ?? null))
      .catch(() => setLatestStatement(null));
  }, [bizId, accountId]);

  function useLatestStatement() {
    if (!latestStatement) return;
    setForm(f => ({
      ...f,
      ...(latestStatement.ending_balance ? { statement_ending_balance: latestStatement.ending_balance } : {}),
      ...(latestStatement.period_end ? { statement_ending_date: latestStatement.period_end } : {}),
    }));
  }

  function handleUploadResult(result: UploadResult) {
    if (result.kind === 'bank_statement' || result.kind === 'credit_card_statement') {
      setStagedId(result.staging_id);
      setAppliedNote(null);
    }
    // Anything else (an invoice, check stubs) isn't a statement — leave
    // stagedId alone; DocumentUpload's own "processed: ..." line already
    // says what it recognised instead, so there's nothing more to show here.
  }

  function handleStatementApproved(summary: { period_end: string | null; ending_balance: string | null; transactionCount: number }) {
    const count = summary.transactionCount;
    setStagedId(null);
    setUploadOpen(false);
    setAppliedNote(`Statement applied — ${count} transaction${count === 1 ? '' : 's'} ready for matching.`);
    setForm(f => ({
      ...f,
      ...(summary.ending_balance ? { statement_ending_balance: summary.ending_balance } : {}),
      ...(summary.period_end ? { statement_ending_date: summary.period_end } : {}),
    }));
    // The approved statement is in the books now; re-check whether it fills
    // anything new (also keeps the "Use this" suggestion banner in sync).
    if (bizId && accountId) {
      api.get<{ statements: StatementBalance[] }>(`/businesses/${bizId}/email-imports/statement-balances`, { params: { account_id: accountId } })
        .then(r => setLatestStatement(r.data.statements[0] ?? null))
        .catch(() => undefined);
    }
  }

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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Reconcile</h1>
        <div className="flex items-center gap-3">
          <Button type="button" variant="outline" size="sm" onClick={() => setUploadOpen(o => !o)}>
            <Upload className="mr-1.5 h-4 w-4" /> Upload Statement
          </Button>
          <ReconcileNav active="setup" accountId={accountId} />
        </div>
      </div>

      {err && (
        <div className="max-w-xl rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {err}
        </div>
      )}

      {appliedNote && (
        <div className="max-w-2xl rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-900">
          {appliedNote}
          {inProgressId && (
            <>
              {' '}<button type="button" className="font-medium underline" onClick={() => navigate(`/accounting/reconcile/${inProgressId}`)}>
                Go to the worksheet
              </button> to see the matches.
            </>
          )}
        </div>
      )}

      {uploadOpen && !accountId && (
        <p className="max-w-xl text-sm text-muted-foreground">Pick an account above first.</p>
      )}

      {uploadOpen && accountId && !stagedId && (
        <div className="max-w-2xl space-y-2">
          <DocumentUpload onUploaded={() => Promise.resolve()} onResult={handleUploadResult} />
          <p className="text-xs text-muted-foreground">
            Also reachable from{' '}
            <Link to="/ai/inbox" className="text-link underline">AI → Document Inbox</Link>
            {' '}— for statements that arrive by email, or a bulk upload.
          </p>
        </div>
      )}

      {uploadOpen && accountId && stagedId && (
        <div className="max-w-2xl">
          <ReconcileStatementReview
            stagingId={stagedId}
            accountId={accountId}
            onApproved={handleStatementApproved}
            onDiscard={() => setStagedId(null)}
          />
        </div>
      )}

      {latestStatement?.ending_balance && latestStatement.period_end && (
        <div className="max-w-xl rounded-md border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-900">
          An approved statement through {fmtShortDate(latestStatement.period_end)} shows an ending balance of{' '}
          {fmtMoney(latestStatement.ending_balance)}.{' '}
          <button type="button" className="font-medium underline" onClick={useLatestStatement}>Use this</button>
        </div>
      )}

      <div className="space-y-2">
        <h2 className="text-base font-medium">Which account do you want to reconcile?</h2>
        <div className="w-64">
          <Label>Account</Label>
          <AppSelect
            className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            value={accountId}
            onChange={e => setAccountId(e.target.value)}
          >
            <option value="">Select…</option>
            {reconcilableAccounts.map(a => (
              <option key={a.id} value={a.id} data-hint={a.category}>
                {a.code} {a.name}
              </option>
            ))}
          </AppSelect>
        </div>

        {inProgressId && (
          <div className="max-w-xl rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            A reconciliation is already in progress for this account.{' '}
            <button type="button" className="font-medium underline" onClick={() => navigate(`/accounting/reconcile/${inProgressId}`)}>
              Resume it
            </button>
            {' '}or finish/cancel it before starting a new one.
          </div>
        )}
      </div>

      <form onSubmit={submit} className="space-y-6">
        <div className="space-y-2">
          <h2 className="text-base font-medium">Add the following information*</h2>
          <div className="flex flex-wrap items-start gap-6">
            <div>
              <Label>Beginning balance</Label>
              <div className="flex h-10 w-32 items-center text-sm font-mono">
                {fmtMoney(beginningBalance)}
              </div>
            </div>
            <div className="w-40">
              <Label>Statement ending balance</Label>
              <MoneyInput
                allowNegative value={form.statement_ending_balance}
                onChange={e => setForm(f => ({ ...f, statement_ending_balance: e.target.value }))}
                placeholder="0.00"
                required
              />
            </div>
            <div className="w-44">
              <Label>Statement ending date</Label>
              <DateInput
                value={form.statement_ending_date}
                onChange={e => setForm(f => ({ ...f, statement_ending_date: e.target.value }))}
                required
              />
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <h2 className="text-base font-medium">Enter the service charge or interest earned, if necessary</h2>
          <div className="flex flex-wrap items-start gap-6">
            <div className="w-36">
              <Label>Date</Label>
              <DateInput
                value={form.service_charge_date}
                onChange={e => setForm(f => ({ ...f, service_charge_date: e.target.value }))}
              />
            </div>
            <div className="w-32">
              <Label>Service charge</Label>
              <MoneyInput
                value={form.service_charge_amount}
                onChange={e => setForm(f => ({ ...f, service_charge_amount: e.target.value }))}
                placeholder="0.00"
              />
            </div>
            <div className="w-48">
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
          </div>
          <div className="flex flex-wrap items-start gap-6">
            <div className="w-36">
              <Label>Date</Label>
              <DateInput
                value={form.interest_earned_date}
                onChange={e => setForm(f => ({ ...f, interest_earned_date: e.target.value }))}
              />
            </div>
            <div className="w-32">
              <Label>Interest earned</Label>
              <MoneyInput
                value={form.interest_earned_amount}
                onChange={e => setForm(f => ({ ...f, interest_earned_amount: e.target.value }))}
                placeholder="0.00"
              />
            </div>
            <div className="w-48">
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
          </div>
        </div>

        <div>
          <Button type="submit" {...hideUnless(can.accountant)} disabled={!canSubmit}>
            {busy
              ? <span className="inline-flex items-center gap-2"><LoadingIndicator size="sm" /> Matching transactions against your statement…</span>
              : 'Start reconciling'}
          </Button>
        </div>
      </form>
    </div>
  );
}
