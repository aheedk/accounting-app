import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { BookOpen, ChevronDown, Clock, Copy, Paperclip, Trash2 } from 'lucide-react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DateInput } from '@/components/ui/date-input';
import { AccountSelect, type AccountLike } from '@/components/ui/AccountSelect';
import { AppSelect } from '@/components/ui/select';
import { fmtMoney } from '@/lib/money';
import { todayLocal } from '@/lib/dates';

type DepositLine = {
  id: string;
  received_from: string;
  account_id: string;
  description: string;
  payment_method: string;
  ref_no: string;
  amount: string;
  account_name?: string;
};

type DepositDetail = {
  id: string;
  bank_account_id: string;
  bank_account_name: string;
  deposit_date: string;
  deposit_number: string;
  memo: string | null;
  total_amount: string;
  cash_back_account_id: string | null;
  cash_back_memo: string | null;
  cash_back_amount: string | null;
  journal_entry_id: string | null;
  lines: DepositLine[];
};

type BankAccount = { id: string; name: string; balance: string };

function emptyLine(idx: number): DepositLine {
  return { id: `new-${idx}`, received_from: '', account_id: '', description: '', payment_method: '', ref_no: '', amount: '' };
}

export default function BankDepositPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = !id || id === 'new';
  const [bizId] = useActiveBusinessId();
  const nav = useNavigate();

  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [accounts, setAccounts] = useState<AccountLike[]>([]);
  const [deposit, setDeposit] = useState<DepositDetail | null>(null);

  const [bankAccountId, setBankAccountId] = useState('');
  const [depositDate, setDepositDate] = useState(todayLocal());
  const [memo, setMemo] = useState('');
  const [lines, setLines] = useState<DepositLine[]>([emptyLine(0), emptyLine(1)]);
  const [cashBackAccountId, setCashBackAccountId] = useState('');
  const [cashBackMemo, setCashBackMemo] = useState('');
  const [cashBackAmount, setCashBackAmount] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showSaveMenu, setShowSaveMenu] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  const load = useCallback(async () => {
    if (!bizId) return;
    const [baRes, coaRes] = await Promise.all([
      api.get<BankAccount[]>(`/businesses/${bizId}/bank-accounts`),
      api.get<{ accounts: AccountLike[] }>(`/businesses/${bizId}/chart-of-accounts`),
    ]);
    const bas = Array.isArray(baRes.data) ? baRes.data : [];
    setBankAccounts(bas);
    setAccounts(coaRes.data?.accounts ?? []);
    if (bas.length > 0 && !bankAccountId) setBankAccountId(bas[0]!.id);

    if (!isNew && id) {
      const res = await api.get<DepositDetail>(`/businesses/${bizId}/bank-deposits/${id}`);
      const d = res.data;
      setDeposit(d);
      setBankAccountId(d.bank_account_id);
      setDepositDate(d.deposit_date);
      setMemo(d.memo ?? '');
      setLines(d.lines.length > 0 ? d.lines.map(l => ({ ...l })) : [emptyLine(0), emptyLine(1)]);
      setCashBackAccountId(d.cash_back_account_id ?? '');
      setCashBackMemo(d.cash_back_memo ?? '');
      setCashBackAmount(d.cash_back_amount ?? '');
    }
  }, [bizId, id, isNew]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void load(); }, [load]);

  function updateLine(idx: number, field: keyof DepositLine, value: string) {
    setLines(prev => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l));
  }
  function removeLine(idx: number) {
    setLines(prev => prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx));
  }

  const linesTotal = lines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);
  const cashBackNum = parseFloat(cashBackAmount) || 0;
  const netTotal = linesTotal - cashBackNum;
  const selectedBankAccount = bankAccounts.find(b => b.id === bankAccountId);

  async function handleSave() {
    setErr(null);
    const validLines = lines.filter(l => l.account_id && parseFloat(l.amount || '0') !== 0);
    if (!bankAccountId) { setErr('Please select a bank account.'); return; }
    if (validLines.length === 0) { setErr('Add at least one line with an account and amount.'); return; }
    setBusy(true);
    try {
      const body = {
        bank_account_id: bankAccountId,
        deposit_date: depositDate,
        memo: memo || null,
        lines: validLines.map((l, i) => ({
          received_from: l.received_from || null,
          account_id: l.account_id,
          description: l.description || null,
          payment_method: l.payment_method || null,
          ref_no: l.ref_no || null,
          amount: String(parseFloat(l.amount)),
          sort_order: i,
        })),
        cash_back_account_id: cashBackAccountId || null,
        cash_back_memo: cashBackMemo || null,
        cash_back_amount: cashBackNum > 0 ? String(cashBackNum) : null,
      };
      const res = await api.post<{ id: string }>(`/businesses/${bizId}/bank-deposits`, body);
      nav(`/accounting/bank-deposits/${res.data.id}`);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to save deposit.');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!id || !bizId) return;
    if (!confirm('Delete this deposit? The journal entry will be voided.')) return;
    setBusy(true);
    try {
      await api.delete(`/businesses/${bizId}/bank-deposits/${id}`);
      nav('/accounting/bank-transactions');
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to delete deposit.');
    } finally {
      setBusy(false);
    }
  }

  if (!bizId) return <div className="p-6">Pick a business.</div>;

  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col -mx-6 -my-6">
      {/* ── Top title bar ── */}
      <div className="flex flex-wrap items-center gap-3 border-b bg-background px-6 py-4">
        <h1 className="text-xl font-semibold">
          Bank Deposit{deposit ? ` — ${deposit.deposit_number}` : ''}
        </h1>
        {deposit && (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
            Posted
          </span>
        )}
      </div>

      {/* ── Header fields strip ── */}
      <div className="flex items-end justify-between border-b bg-muted/10 px-6 pb-4 pt-5">
        <div className="flex flex-wrap items-end gap-8">
          {/* Account */}
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Account
            </label>
            <div className="flex items-center gap-3">
              <AppSelect
                value={bankAccountId}
                onChange={e => setBankAccountId(e.target.value)}
                disabled={!isNew}
                className="w-56"
              >
                {bankAccounts.map(ba => (
                  <option key={ba.id} value={ba.id}>{ba.name}</option>
                ))}
              </AppSelect>
              {selectedBankAccount && (
                <span className="text-sm text-muted-foreground">
                  Balance {fmtMoney(selectedBankAccount.balance ?? '0')}
                </span>
              )}
            </div>
          </div>

          {/* Date */}
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Date
            </label>
            <DateInput
              value={depositDate}
              onChange={e => setDepositDate(e.target.value)}
              disabled={!isNew}
              className="w-44"
            />
          </div>
        </div>

        {/* Amount — top right like QBO */}
        <div className="text-right">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Amount</p>
          <p className="text-4xl font-bold tabular-nums">{fmtMoney(netTotal.toFixed(2))}</p>
        </div>
      </div>

      {/* ── Main content ── */}
      <div className="flex-1 overflow-auto px-6 py-4">

        {/* Add funds section */}
        <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
          <span className="text-muted-foreground">▼</span> Add funds to this deposit
        </h2>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-t">
                <th className="w-8 px-2 py-2.5 text-left text-xs font-semibold text-muted-foreground">#</th>
                <th className="min-w-[140px] px-2 py-2.5 text-left text-xs font-semibold text-muted-foreground">RECEIVED FROM</th>
                <th className="min-w-[180px] px-2 py-2.5 text-left text-xs font-semibold text-muted-foreground">ACCOUNT</th>
                <th className="min-w-[160px] px-2 py-2.5 text-left text-xs font-semibold text-muted-foreground">DESCRIPTION</th>
                <th className="w-36 px-2 py-2.5 text-left text-xs font-semibold text-muted-foreground">PAYMENT METHOD</th>
                <th className="w-28 px-2 py-2.5 text-left text-xs font-semibold text-muted-foreground">REF NO.</th>
                <th className="w-32 px-2 py-2.5 text-right text-xs font-semibold text-muted-foreground">AMOUNT</th>
                <th className="w-14 px-2 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {lines.map((line, idx) => (
                <tr key={line.id} className="group border-b transition-colors hover:bg-muted/40">
                  <td className="px-2 py-1.5 text-xs text-muted-foreground">{idx + 1}</td>
                  <td className="px-2 py-1.5">
                    <Input
                      value={line.received_from}
                      onChange={e => updateLine(idx, 'received_from', e.target.value)}
                      disabled={!isNew}
                      className="w-full"
                      placeholder=""
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <AccountSelect
                      accounts={accounts}
                      value={line.account_id}
                      onChange={v => updateLine(idx, 'account_id', v)}
                      disabled={!isNew}
                      className="w-full"
                      placeholder=""
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <Input
                      value={line.description}
                      onChange={e => updateLine(idx, 'description', e.target.value)}
                      disabled={!isNew}
                      className="w-full"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <Input
                      value={line.payment_method}
                      onChange={e => updateLine(idx, 'payment_method', e.target.value)}
                      disabled={!isNew}
                      className="w-full"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <Input
                      value={line.ref_no}
                      onChange={e => updateLine(idx, 'ref_no', e.target.value)}
                      disabled={!isNew}
                      className="w-full"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <Input
                      value={line.amount}
                      onChange={e => updateLine(idx, 'amount', e.target.value)}
                      disabled={!isNew}
                      className="w-full text-right font-mono"
                      placeholder="0.00"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    {isNew && (
                      <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          type="button"
                          onClick={() => removeLine(idx)}
                          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
                          aria-label="Remove line"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {isNew && (
          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={() => setLines(prev => [...prev, emptyLine(prev.length)])}
              className="rounded border px-3 py-1.5 text-sm transition-colors hover:bg-muted/50"
            >
              Add lines
            </button>
            <button
              type="button"
              onClick={() => setLines([emptyLine(0), emptyLine(1)])}
              className="rounded border px-3 py-1.5 text-sm transition-colors hover:bg-muted/50"
            >
              Clear all lines
            </button>
          </div>
        )}

        {/* Bottom section: memo/attachments left, totals right */}
        <div className="mt-8 grid grid-cols-1 gap-8 md:grid-cols-2">
          {/* Left */}
          <div>
            <label className="mb-2 block text-sm font-medium">Memo</label>
            <textarea
              value={memo}
              onChange={e => setMemo(e.target.value)}
              disabled={!isNew}
              rows={4}
              className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
            />
            <label className="mb-2 mt-4 block text-sm font-medium">Attachments</label>
            <div className="flex h-[108px] flex-col items-center justify-center gap-1.5 rounded-md border-2 border-dashed text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:bg-muted/20">
              <Paperclip className="h-5 w-5" />
              <span className="text-primary cursor-pointer hover:underline">Add attachment</span>
              <span className="text-xs">Max file size: 20 MB</span>
            </div>
          </div>

          {/* Right: totals */}
          <div className="flex flex-col gap-4">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Other funds total</span>
              <span className="font-mono font-medium">{fmtMoney(linesTotal.toFixed(2))}</span>
            </div>

            <div className="rounded-md border p-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cash back</p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Goes to</label>
                  <AccountSelect
                    accounts={accounts}
                    value={cashBackAccountId}
                    onChange={setCashBackAccountId}
                    disabled={!isNew}
                    placeholder="Choose an account"
                    className="w-full"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Memo</label>
                  <Input
                    value={cashBackMemo}
                    onChange={e => setCashBackMemo(e.target.value)}
                    disabled={!isNew}
                    className="h-9"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Amount</label>
                  <Input
                    value={cashBackAmount}
                    onChange={e => setCashBackAmount(e.target.value)}
                    disabled={!isNew}
                    className="h-9 text-right font-mono"
                    placeholder="0.00"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-between border-t pt-3 text-sm font-semibold">
              <span>Total</span>
              <span className="font-mono">{fmtMoney(netTotal.toFixed(2))}</span>
            </div>
          </div>
        </div>
      </div>

      {err && <p className="px-6 pb-2 text-sm text-destructive">{err}</p>}

      {/* ── Sticky bottom action bar ── */}
      <div className="sticky bottom-0 flex items-center gap-3 border-t bg-background px-6 py-3">
        <Button type="button" variant="outline" onClick={() => nav('/accounting/bank-transactions')}>
          Cancel
        </Button>

        {/* Print / Make recurring / More — center */}
        <div className="mx-auto flex items-center gap-3 text-sm">
          <button
            type="button"
            onClick={() => window.print()}
            className="text-primary hover:underline"
          >
            Print
          </button>
          <span className="text-muted-foreground">·</span>
          <button
            type="button"
            className="text-primary hover:underline"
            onClick={() => alert('Make recurring — coming soon')}
          >
            Make recurring
          </button>

          {!isNew && (
            <>
              <span className="text-muted-foreground">·</span>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setMoreOpen(prev => !prev)}
                  className="text-primary hover:underline"
                >
                  More
                </button>
                {moreOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setMoreOpen(false)} />
                    <div className="absolute bottom-8 left-0 z-50 w-52 rounded-lg border bg-card shadow-xl">
                      <button
                        type="button"
                        onClick={() => { setMoreOpen(false); alert('Copy — coming soon'); }}
                        className="flex w-full items-center gap-2 px-4 py-2.5 text-sm hover:bg-accent"
                      >
                        <Copy className="h-4 w-4" /> Copy
                      </button>
                      <button
                        type="button"
                        onClick={() => { setMoreOpen(false); void handleDelete(); }}
                        className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-destructive hover:bg-accent"
                      >
                        <Trash2 className="h-4 w-4" /> Delete
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setMoreOpen(false);
                          if (deposit?.journal_entry_id) nav(`/journal/${deposit.journal_entry_id}`);
                        }}
                        disabled={!deposit?.journal_entry_id}
                        className="flex w-full items-center gap-2 px-4 py-2.5 text-sm hover:bg-accent disabled:opacity-40"
                      >
                        <BookOpen className="h-4 w-4" /> Transaction journal
                      </button>
                      <button
                        type="button"
                        onClick={() => { setMoreOpen(false); alert('Audit history — coming soon'); }}
                        className="flex w-full items-center gap-2 px-4 py-2.5 text-sm hover:bg-accent"
                      >
                        <Clock className="h-4 w-4" /> Audit history
                      </button>
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </div>

        {/* Save button — right */}
        {isNew && (
          <div className="relative flex">
            <Button
              type="button"
              disabled={busy}
              onClick={() => { void handleSave(); }}
              className="rounded-r-none"
            >
              {busy ? 'Saving…' : 'Save and new'}
            </Button>
            <Button
              type="button"
              aria-label="Save options"
              onClick={() => setShowSaveMenu(prev => !prev)}
              className="rounded-l-none border-l border-l-primary-foreground/30 px-2"
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
            {showSaveMenu && (
              <div className="absolute bottom-full right-0 z-50 mb-1 w-44 rounded-md border bg-background py-1 shadow-lg">
                <button
                  type="button"
                  className="w-full px-4 py-2.5 text-left text-sm hover:bg-accent"
                  onClick={() => { setShowSaveMenu(false); void handleSave(); }}
                >
                  Save and close
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <style>{`@media print { .sticky { display: none !important; } }`}</style>
    </div>
  );
}
