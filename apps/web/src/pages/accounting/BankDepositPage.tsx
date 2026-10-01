import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, Printer, RotateCcw, MoreHorizontal, Copy, Trash2, BookOpen, Clock } from 'lucide-react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DateInput } from '@/components/ui/date-input';
import { AccountSelect, type AccountLike } from '@/components/ui/AccountSelect';
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
  account_code?: string;
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

type BankAccount = {
  id: string;
  name: string;
  balance: string;
  cash_account_id: string;
};

type Account = AccountLike;

function emptyLine(idx: number): DepositLine {
  return {
    id: `new-${idx}`,
    received_from: '',
    account_id: '',
    description: '',
    payment_method: '',
    ref_no: '',
    amount: '',
  };
}

export default function BankDepositPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = !id || id === 'new';
  const [bizId] = useActiveBusinessId();
  const nav = useNavigate();

  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [deposit, setDeposit] = useState<DepositDetail | null>(null);

  // form state
  const [bankAccountId, setBankAccountId] = useState('');
  const [depositDate, setDepositDate] = useState(todayLocal());
  const [memo, setMemo] = useState('');
  const [lines, setLines] = useState<DepositLine[]>([emptyLine(0), emptyLine(1)]);
  const [cashBackAccountId, setCashBackAccountId] = useState('');
  const [cashBackMemo, setCashBackMemo] = useState('');
  const [cashBackAmount, setCashBackAmount] = useState('');

  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  const load = useCallback(async () => {
    if (!bizId) return;
    const [baRes, coaRes] = await Promise.all([
      api.get<BankAccount[]>(`/businesses/${bizId}/bank-accounts`),
      api.get<{ accounts: Account[] }>(`/businesses/${bizId}/chart-of-accounts`),
    ]);
    const bas = Array.isArray(baRes.data) ? baRes.data : [];
    const coa = coaRes.data?.accounts ?? [];
    setBankAccounts(bas);
    setAccounts(coa);
    if (bas.length > 0 && !bankAccountId) setBankAccountId(bas[0]!.id);

    if (!isNew && id) {
      const res = await api.get<DepositDetail>(`/businesses/${bizId}/bank-deposits/${id}`);
      const d = res.data;
      setDeposit(d);
      setBankAccountId(d.bank_account_id);
      setDepositDate(d.deposit_date);
      setMemo(d.memo ?? '');
      setLines(
        d.lines.length > 0
          ? d.lines.map(l => ({ ...l }))
          : [emptyLine(0), emptyLine(1)],
      );
      setCashBackAccountId(d.cash_back_account_id ?? '');
      setCashBackMemo(d.cash_back_memo ?? '');
      setCashBackAmount(d.cash_back_amount ?? '');
    }
  }, [bizId, id, isNew]);

  useEffect(() => { void load(); }, [load]);

  function updateLine(idx: number, field: keyof DepositLine, value: string) {
    setLines(prev => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l));
  }

  function addLine() {
    setLines(prev => [...prev, emptyLine(prev.length)]);
  }

  function clearLines() {
    setLines([emptyLine(0), emptyLine(1)]);
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

  function handlePrint() { window.print(); }

  const title = isNew ? 'Bank Deposit' : `Bank Deposit${deposit ? ` — ${deposit.deposit_number}` : ''}`;

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b px-6 py-3">
        <button
          type="button"
          onClick={() => nav('/accounting/bank-transactions')}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          {title}
        </button>
        <div className="flex items-center gap-3">
          {/* Feedback / Help / Close placeholders */}
          <span className="text-sm text-muted-foreground select-none">Feedback</span>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-6 py-6">
        {/* Header row */}
        <div className="mb-6 flex items-start justify-between">
          <div className="flex flex-col gap-4">
            {/* Account selector */}
            <div className="flex items-center gap-4">
              <div>
                <Label className="text-xs text-muted-foreground">Account</Label>
                <div className="mt-1 flex items-center gap-2">
                  <select
                    value={bankAccountId}
                    onChange={e => setBankAccountId(e.target.value)}
                    disabled={!isNew}
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    {bankAccounts.map(ba => (
                      <option key={ba.id} value={ba.id}>{ba.name}</option>
                    ))}
                  </select>
                  {selectedBankAccount?.balance !== undefined && (
                    <span className="text-sm text-muted-foreground">
                      Balance {fmtMoney(selectedBankAccount.balance)}
                    </span>
                  )}
                </div>
              </div>

              {/* Date */}
              <div>
                <Label className="text-xs text-muted-foreground">Date</Label>
                <div className="mt-1">
                  <DateInput
                    value={depositDate}
                    onChange={e => setDepositDate(e.target.value)}
                    disabled={!isNew}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Total top-right */}
          <div className="text-right">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Amount</p>
            <p className="text-4xl font-bold">{fmtMoney(netTotal.toFixed(2))}</p>
          </div>
        </div>

        {/* Add funds section */}
        <div className="mb-4">
          <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
            <span>▼</span> Add funds to this deposit
          </h2>

          {/* Lines table */}
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <th className="w-8 py-2 pl-3 text-left">#</th>
                  <th className="py-2 pl-2 text-left">Received From</th>
                  <th className="py-2 pl-2 text-left">Account</th>
                  <th className="py-2 pl-2 text-left">Description</th>
                  <th className="py-2 pl-2 text-left">Payment Method</th>
                  <th className="py-2 pl-2 text-left">Ref No.</th>
                  <th className="py-2 pl-2 pr-3 text-right">Amount</th>
                  {isNew && <th className="w-8" />}
                </tr>
              </thead>
              <tbody>
                {lines.map((line, idx) => (
                  <tr key={line.id} className="border-b last:border-0">
                    <td className="py-1.5 pl-3 text-muted-foreground">{idx + 1}</td>
                    <td className="py-1.5 pl-2">
                      <Input
                        value={line.received_from}
                        onChange={e => updateLine(idx, 'received_from', e.target.value)}
                        disabled={!isNew}
                        className="h-8 min-w-[120px] border-0 bg-transparent px-1 shadow-none focus-visible:ring-1"
                      />
                    </td>
                    <td className="py-1.5 pl-2">
                      <AccountSelect
                        accounts={accounts}
                        value={line.account_id}
                        onChange={v => updateLine(idx, 'account_id', v)}
                        disabled={!isNew}
                        className="min-w-[180px]"
                        placeholder="Select account…"
                      />
                    </td>
                    <td className="py-1.5 pl-2">
                      <Input
                        value={line.description}
                        onChange={e => updateLine(idx, 'description', e.target.value)}
                        disabled={!isNew}
                        className="h-8 min-w-[140px] border-0 bg-transparent px-1 shadow-none focus-visible:ring-1"
                      />
                    </td>
                    <td className="py-1.5 pl-2">
                      <Input
                        value={line.payment_method}
                        onChange={e => updateLine(idx, 'payment_method', e.target.value)}
                        disabled={!isNew}
                        className="h-8 min-w-[100px] border-0 bg-transparent px-1 shadow-none focus-visible:ring-1"
                      />
                    </td>
                    <td className="py-1.5 pl-2">
                      <Input
                        value={line.ref_no}
                        onChange={e => updateLine(idx, 'ref_no', e.target.value)}
                        disabled={!isNew}
                        className="h-8 min-w-[80px] border-0 bg-transparent px-1 shadow-none focus-visible:ring-1"
                      />
                    </td>
                    <td className="py-1.5 pl-2 pr-3 text-right">
                      <Input
                        value={line.amount}
                        onChange={e => updateLine(idx, 'amount', e.target.value)}
                        disabled={!isNew}
                        className="h-8 w-28 border-0 bg-transparent px-1 text-right shadow-none focus-visible:ring-1"
                        placeholder="0.00"
                      />
                    </td>
                    {isNew && (
                      <td className="pr-2">
                        <button
                          type="button"
                          onClick={() => removeLine(idx)}
                          className="rounded p-1 text-muted-foreground hover:text-destructive"
                        >
                          ✕
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {isNew && (
            <div className="mt-2 flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={addLine}>
                Add lines
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={clearLines}>
                Clear all lines
              </Button>
            </div>
          )}
        </div>

        {/* Bottom section: memo left, totals right */}
        <div className="flex gap-8">
          {/* Left: memo + attachments */}
          <div className="flex-1">
            <div className="mb-4">
              <Label className="text-sm font-medium">Memo</Label>
              <textarea
                value={memo}
                onChange={e => setMemo(e.target.value)}
                disabled={!isNew}
                rows={5}
                className="mt-1 w-full max-w-sm rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
              />
            </div>
            <div>
              <Label className="text-sm font-medium">Attachments</Label>
              <div className="mt-1 flex h-24 max-w-sm flex-col items-center justify-center rounded-md border border-dashed border-input text-sm text-muted-foreground">
                <span className="text-primary cursor-pointer hover:underline">Add attachment</span>
                <span className="text-xs">Max file size: 20 MB</span>
              </div>
            </div>
          </div>

          {/* Right: cash back + totals */}
          <div className="w-80 shrink-0">
            <div className="mb-4 flex justify-between text-sm">
              <span className="font-medium text-muted-foreground">Other funds total</span>
              <span>{fmtMoney(linesTotal.toFixed(2))}</span>
            </div>

            <div className="mb-4 grid grid-cols-3 gap-2 rounded-md border p-3">
              <div>
                <Label className="text-xs text-muted-foreground">Cash back goes to</Label>
                <div className="mt-1">
                  <AccountSelect
                    accounts={accounts}
                    value={cashBackAccountId}
                    onChange={setCashBackAccountId}
                    disabled={!isNew}
                    placeholder="Choose an account"
                    className="w-full"
                  />
                </div>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Cash back memo</Label>
                <Input
                  value={cashBackMemo}
                  onChange={e => setCashBackMemo(e.target.value)}
                  disabled={!isNew}
                  className="mt-1 h-9"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Cash back amount</Label>
                <Input
                  value={cashBackAmount}
                  onChange={e => setCashBackAmount(e.target.value)}
                  disabled={!isNew}
                  className="mt-1 h-9 text-right"
                  placeholder="0.00"
                />
              </div>
            </div>

            <div className="flex justify-between border-t pt-3 text-sm font-semibold">
              <span>Total</span>
              <span>{fmtMoney(netTotal.toFixed(2))}</span>
            </div>
          </div>
        </div>

        {err && (
          <p className="mt-4 text-sm text-destructive">{err}</p>
        )}
      </div>

      {/* Bottom action bar */}
      <div className="fixed bottom-0 left-0 right-0 flex items-center justify-between border-t bg-background px-6 py-3">
        <Button type="button" variant="outline" onClick={() => nav('/accounting/bank-transactions')}>
          Cancel
        </Button>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handlePrint}
            className="text-sm text-primary hover:underline"
          >
            Print
          </button>
          <span className="text-muted-foreground">·</span>
          <button
            type="button"
            className="text-sm text-primary hover:underline"
            onClick={() => alert('Make recurring — coming soon')}
          >
            Make recurring
          </button>

          {!isNew && (
            <>
              <span className="text-muted-foreground">·</span>
              {/* More dropdown */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setMoreOpen(prev => !prev)}
                  className="text-sm text-primary hover:underline"
                >
                  More
                </button>
                {moreOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setMoreOpen(false)}
                    />
                    <div className="absolute bottom-8 right-0 z-50 w-52 rounded-lg border bg-card shadow-xl">
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
                          if (deposit?.journal_entry_id) {
                            nav(`/journal/${deposit.journal_entry_id}`);
                          }
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

          {isNew && (
            <div className="flex items-center">
              <Button
                type="button"
                onClick={() => void handleSave()}
                disabled={busy}
                className="rounded-r-none"
              >
                {busy ? 'Saving…' : 'Save and new'}
              </Button>
              <Button
                type="button"
                variant="default"
                className="rounded-l-none border-l border-l-white/20 px-2"
                onClick={() => setMoreOpen(prev => !prev)}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Print styles */}
      <style>{`
        @media print {
          .fixed { display: none !important; }
        }
      `}</style>
    </div>
  );
}
