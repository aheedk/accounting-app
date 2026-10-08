import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { hasMinRole } from '@accounting/shared';
import { BookOpen, ChevronDown, Clock, Copy, History, Trash2, X } from 'lucide-react';
import { api } from '@/lib/apiClient';
import { cachedGet, invalidateReferenceCache } from '@/lib/referenceDataCache';
import { useActiveBusinessId } from '@/lib/business';
import { useAuth } from '@/auth/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { DateInput } from '@/components/ui/date-input';
import { AccountSelect, type AccountLike } from '@/components/ui/AccountSelect';
import { AppSelect } from '@/components/ui/select';
import { useAttachments, AttachmentsPanel } from '@/components/Attachments';
import { AuditHistoryModal } from '@/components/AuditHistoryModal';
import { fmtMoney } from '@/lib/money';
import { todayLocal } from '@/lib/dates';
import { previewDepositSummary, previewDepositSlipAndSummary, previewDepositAlignmentTest, type DepositDocInput } from '@/lib/download';
import { humanizeCode } from '@/lib/labels';

// ── Types ──────────────────────────────────────────────────────────────────

type UndepositedPayment = {
  id: string;
  payment_date: string;
  payment_method: string;
  reference: string | null;
  amount: string;
  memo: string | null;
  cash_account_id: string;
  cash_account_name: string;
  cash_account_code: string;
  customer_id: string;
  customer_name: string;
};

type OtherFundsLine = {
  id: string;
  received_from: string;
  account_id: string;
  description: string;
  payment_method: string;
  ref_no: string;
  amount: string;
  account_name?: string;
};

type DepositLine = OtherFundsLine & {
  line_type?: 'other_funds' | 'undeposited_funds';
  payment_id?: string | null;
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
  voided_at: string | null;
  // False once voided — a terminal, read-only state (see voidDeposit).
  editable: boolean;
  // True when this deposit wraps a journal entry this feature didn't post
  // itself (AI-coded from a bank statement import) — informational only.
  imported: boolean;
  is_reconciled: boolean;
  lines: DepositLine[];
};

type BankAccount = { id: string; name: string; balance: string; account_last_four: string | null };
type RecentDeposit = { id: string; deposit_date: string; deposit_number: string; total_amount: string };

// ── Recurring dialog types ─────────────────────────────────────────────────

type RecurrenceType = 'scheduled' | 'reminder' | 'unscheduled';
type IntervalType = 'daily' | 'weekly' | 'monthly' | 'yearly';

type RecurringForm = {
  name: string;
  recurrence_type: RecurrenceType;
  interval_type: IntervalType;
  interval_value: string;
  days_in_advance: string;
  start_date: string;
  end_date: string;
};

// ── Helpers ────────────────────────────────────────────────────────────────

function emptyLine(idx: number): OtherFundsLine {
  return { id: `new-${idx}`, received_from: '', account_id: '', description: '', payment_method: '', ref_no: '', amount: '' };
}

function fmtDate(iso: string) {
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y}`;
}

// ── Make Recurring Dialog ──────────────────────────────────────────────────

function RecurringDialog({
  bankAccountId,
  otherLines,
  depositDate,
  memo,
  onClose,
  onSaved,
  bizId,
}: {
  bankAccountId: string;
  otherLines: OtherFundsLine[];
  depositDate: string;
  memo: string;
  onClose: () => void;
  onSaved: () => void;
  bizId: string;
}) {
  const [form, setForm] = useState<RecurringForm>({
    name: '',
    recurrence_type: 'scheduled',
    interval_type: 'monthly',
    interval_value: '1',
    days_in_advance: '0',
    start_date: depositDate,
    end_date: '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function update(patch: Partial<RecurringForm>) {
    setForm(prev => ({ ...prev, ...patch }));
  }

  // Map our interval_type to what the recurring_templates table supports
  const recurrenceMap: Record<IntervalType, 'weekly' | 'monthly' | 'quarterly' | 'yearly'> = {
    daily: 'weekly', // closest available; daily not in enum
    weekly: 'weekly',
    monthly: 'monthly',
    yearly: 'yearly',
  };

  async function handleSave() {
    if (!form.name.trim()) { setErr('Template name is required.'); return; }
    setBusy(true);
    setErr(null);
    try {
      await api.post(`/businesses/${bizId}/recurring-templates`, {
        name: form.name,
        template_type: 'deposit',
        recurrence: recurrenceMap[form.interval_type],
        next_run_date: form.start_date || depositDate,
        end_date: form.end_date || null,
        payload: {
          bank_account_id: bankAccountId,
          memo,
          recurrence_type: form.recurrence_type,
          interval_type: form.interval_type,
          interval_value: parseInt(form.interval_value) || 1,
          days_in_advance: parseInt(form.days_in_advance) || 0,
          lines: otherLines.filter(l => l.account_id && parseFloat(l.amount || '0') !== 0).map(l => ({
            received_from: l.received_from || null,
            account_id: l.account_id,
            description: l.description || null,
            payment_method: l.payment_method || null,
            ref_no: l.ref_no || null,
            amount: l.amount,
          })),
        },
      });
      onSaved();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to save template.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-12">
      <div className="w-full max-w-2xl rounded-lg border bg-background shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recurring Bank Deposit</p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5 px-6 py-5">
          {/* Template name + Type */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Template name
              </label>
              <Input
                value={form.name}
                onChange={e => update({ name: e.target.value })}
                placeholder="Template name"
                className="h-9"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Type
              </label>
              <AppSelect
                value={form.recurrence_type}
                onChange={e => update({ recurrence_type: e.target.value as RecurrenceType })}
                className="w-full"
              >
                <option value="scheduled">Scheduled</option>
                <option value="reminder">Reminder</option>
                <option value="unscheduled">Unscheduled</option>
              </AppSelect>
            </div>
            {form.recurrence_type !== 'unscheduled' && (
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Create days in advance
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    value={form.days_in_advance}
                    onChange={e => update({ days_in_advance: e.target.value })}
                    className="h-9 w-20"
                    min="0"
                  />
                  <span className="text-sm text-muted-foreground">days in advance</span>
                </div>
              </div>
            )}
          </div>

          {/* Interval section — only for scheduled/reminder */}
          {form.recurrence_type !== 'unscheduled' && (
            <>
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Interval
                  </label>
                  <AppSelect
                    value={form.interval_type}
                    onChange={e => update({ interval_type: e.target.value as IntervalType })}
                    className="w-32"
                  >
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly</option>
                  </AppSelect>
                </div>
                <span className="pb-2 text-sm text-muted-foreground">of every</span>
                <div>
                  <Input
                    type="number"
                    value={form.interval_value}
                    onChange={e => update({ interval_value: e.target.value })}
                    className="h-9 w-20"
                    min="1"
                  />
                </div>
                <span className="pb-2 text-sm text-muted-foreground">
                  {form.interval_type}(s)
                </span>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Start date
                  </label>
                  <DateInput
                    value={form.start_date}
                    onChange={e => update({ start_date: e.target.value })}
                    className="w-full"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    End (optional)
                  </label>
                  <DateInput
                    value={form.end_date}
                    onChange={e => update({ end_date: e.target.value })}
                    className="w-full"
                  />
                </div>
              </div>
            </>
          )}

          {err && <p className="text-sm text-destructive">{err}</p>}
        </div>

        <div className="flex justify-between border-t px-6 py-4">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => { void handleSave(); }} disabled={busy}>
            {busy ? 'Saving…' : 'Save template'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────

export default function BankDepositPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = !id || id === 'new';
  const [bizId] = useActiveBusinessId();
  const nav = useNavigate();
  const { user, businesses } = useAuth();
  const role = businesses.find(b => b.id === bizId)?.role_override ?? user?.role;

  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [accounts, setAccounts] = useState<AccountLike[]>([]);
  const [contactNames, setContactNames] = useState<string[]>([]);
  const [bookBalance, setBookBalance] = useState<string | null>(null);
  const [undepositedPayments, setUndepositedPayments] = useState<UndepositedPayment[]>([]);
  const [deposit, setDeposit] = useState<DepositDetail | null>(null);

  // Selected undeposited payments (by id)
  const [selectedPaymentIds, setSelectedPaymentIds] = useState<Set<string>>(new Set());

  // Form state
  const [bankAccountId, setBankAccountId] = useState('');
  const [depositDate, setDepositDate] = useState(todayLocal());
  const [memo, setMemo] = useState('');
  const [otherLines, setOtherLines] = useState<OtherFundsLine[]>([emptyLine(0), emptyLine(1)]);
  const [cashBackAccountId, setCashBackAccountId] = useState('');
  const [cashBackMemo, setCashBackMemo] = useState('');
  const [cashBackAmount, setCashBackAmount] = useState('');

  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showSaveMenu, setShowSaveMenu] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [recurringOpen, setRecurringOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  // Set when this form was filled from More → Copy, so loading does not put the first bank account back.
  const copiedFrom = useRef(false);
  const [recentOpen, setRecentOpen] = useState(false);
  const [recentDeposits, setRecentDeposits] = useState<RecentDeposit[] | null>(null);
  const attachments = useAttachments('bank_deposit', isNew ? null : (id ?? null));

  const load = useCallback(async () => {
    if (!bizId) return;
    // bank-accounts/coa/customers/vendors are slow-changing reference data
    // fetched by many unrelated pages on every mount with no sharing — route
    // them through the shared cache so navigating within this workflow
    // (deposit list -> deposit -> back) doesn't refire all four every time.
    const [baData, coaData, upRes, custData, vendData] = await Promise.all([
      cachedGet<{ bank_accounts: BankAccount[] }>(`/businesses/${bizId}/bank-accounts`),
      cachedGet<{ accounts: AccountLike[] }>(`/businesses/${bizId}/coa`),
      isNew ? api.get<UndepositedPayment[]>(`/businesses/${bizId}/bank-deposits/undeposited-payments`) : Promise.resolve({ data: [] as UndepositedPayment[] }),
      cachedGet<{ customers: Array<{ id: string; name: string }> }>(`/businesses/${bizId}/customers`),
      cachedGet<{ vendors: Array<{ id: string; name: string }> }>(`/businesses/${bizId}/vendors`),
    ]);

    const bas = baData?.bank_accounts ?? [];
    setBankAccounts(bas);
    setAccounts(coaData?.accounts ?? []);
    setUndepositedPayments(Array.isArray(upRes.data) ? upRes.data : []);
    setContactNames([
      ...(custData?.customers ?? []).map(c => c.name),
      ...(vendData?.vendors ?? []).map(v => v.name),
    ]);
    if (bas.length > 0 && !bankAccountId && !copiedFrom.current) setBankAccountId(bas[0]!.id);

    if (!isNew && id) {
      const res = await api.get<DepositDetail>(`/businesses/${bizId}/bank-deposits/${id}`);
      const d = res.data;
      setDeposit(d);
      setBankAccountId(d.bank_account_id);
      setDepositDate(d.deposit_date);
      setMemo(d.memo ?? '');
      const other = d.lines.filter(l => l.line_type !== 'undeposited_funds');
      setOtherLines(other.length > 0 ? other : [emptyLine(0), emptyLine(1)]);
      setCashBackAccountId(d.cash_back_account_id ?? '');
      setCashBackMemo(d.cash_back_memo ?? '');
      setCashBackAmount(d.cash_back_amount ?? '');
    }
  }, [bizId, id, isNew]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void load(); }, [load]);

  // More → Copy: a new deposit with the same bank account, memo, cash back and
  // typed lines, dated today. Payments taken from Undeposited Funds are not
  // copied; they were deposited once. Same hand-off as Check and Expense.
  function handleCopy() {
    const draft = {
      bankAccountId, memo, cashBackAccountId, cashBackMemo, cashBackAmount,
      lines: otherLines.filter(l => l.account_id || l.amount).map((l, i) => ({ ...l, id: `new-${i}` })),
    };
    sessionStorage.setItem('bank-deposit-copy-draft', JSON.stringify(draft));
    nav('/accounting/bank-deposits/new?copy=1');
  }

  // Pick up a copied draft dropped by handleCopy, once, on a fresh "new" form.
  useEffect(() => {
    if (!isNew) return;
    const raw = sessionStorage.getItem('bank-deposit-copy-draft');
    if (!raw) return;
    sessionStorage.removeItem('bank-deposit-copy-draft');
    try {
      const draft = JSON.parse(raw) as {
        bankAccountId: string; memo: string; cashBackAccountId: string; cashBackMemo: string; cashBackAmount: string;
        lines: OtherFundsLine[];
      };
      copiedFrom.current = true;
      setDeposit(null);
      setSelectedPaymentIds(new Set());
      setBankAccountId(draft.bankAccountId);
      setMemo(draft.memo);
      setCashBackAccountId(draft.cashBackAccountId);
      setCashBackMemo(draft.cashBackMemo);
      setCashBackAmount(draft.cashBackAmount);
      setOtherLines(draft.lines.length > 0 ? draft.lines : [emptyLine(0), emptyLine(1)]);
      setDepositDate(todayLocal());
      setErr(null);
    } catch { /* ignore a malformed draft */ }
  }, [isNew]);

  // Book balance (posted JE debits minus credits on the account's GL cash
  // account) — distinct from the bank-feed balance, which reads $0.00 for any
  // account that's never had a CSV statement imported. Short TTL so switching
  // back to an already-picked account in the same session doesn't re-fetch,
  // but it still updates on its own shortly after a save.
  const loadBookBalance = useCallback(async () => {
    if (!bizId || !bankAccountId) { setBookBalance(null); return; }
    try {
      const data = await cachedGet<{ book_balance: string }>(`/businesses/${bizId}/bank-accounts/${bankAccountId}`, 15_000);
      setBookBalance(data.book_balance);
    } catch {
      setBookBalance(null);
    }
  }, [bizId, bankAccountId]);

  useEffect(() => { void loadBookBalance(); }, [loadBookBalance]);

  // Toggle a payment in/out of selection
  async function toggleRecent() {
    if (recentOpen) { setRecentOpen(false); return; }
    setRecentOpen(true);
    if (recentDeposits === null && bizId) {
      try {
        const res = await api.get<RecentDeposit[]>(`/businesses/${bizId}/bank-deposits`);
        setRecentDeposits(Array.isArray(res.data) ? res.data.slice(0, 10) : []);
      } catch {
        setRecentDeposits([]);
      }
    }
  }

  function togglePayment(paymentId: string) {
    setSelectedPaymentIds(prev => {
      const next = new Set(prev);
      next.has(paymentId) ? next.delete(paymentId) : next.add(paymentId);
      return next;
    });
  }

  function updateLine(idx: number, field: keyof OtherFundsLine, value: string) {
    setOtherLines(prev => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l));
  }
  function removeLine(idx: number) {
    setOtherLines(prev => prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx));
  }

  const selectedPayments = undepositedPayments.filter(p => selectedPaymentIds.has(p.id));
  // Editing an existing deposit never reloads the undeposited-payments pool (that
  // selection is fixed), so the subtotal there comes from the posted lines instead.
  const undepositedTotal = isNew
    ? selectedPayments.reduce((s, p) => s + parseFloat(p.amount), 0)
    : (deposit?.lines.filter(l => l.line_type === 'undeposited_funds').reduce((s, l) => s + parseFloat(l.amount), 0) ?? 0);
  const otherTotal = otherLines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);
  const linesTotal = undepositedTotal + otherTotal;
  const cashBackNum = parseFloat(cashBackAmount) || 0;
  const netTotal = linesTotal - cashBackNum;
  const selectedBankAccount = bankAccounts.find(b => b.id === bankAccountId);

  // Editing a posted deposit can change the bank account, date, memo, other-funds
  // lines, and cash-back — but not which Undeposited Funds payments were pulled in;
  // that set was fixed when the deposit was made (see updateDeposit on the API side).
  const hasUndepositedLines = isNew
    ? selectedPaymentIds.size > 0
    : (deposit?.lines.some(l => l.line_type === 'undeposited_funds') ?? false);
  // A new or posted deposit opens directly in edit mode, same as QuickBooks —
  // including one wrapping an AI-coded import (deposit.imported only drives
  // the "Imported" badge). A voided deposit is read-only, same as Expense.
  const canEdit = isNew || (deposit?.editable ?? true);
  const canVoid = role !== undefined && hasMinRole(role, 'accountant');
  const canDelete = role !== undefined && hasMinRole(role, 'firm_admin');

  async function handleSave() {
    setErr(null);
    const validOther = otherLines.filter(l => l.account_id && parseFloat(l.amount || '0') !== 0);
    if (!bankAccountId) { setErr('Please select a bank account.'); return; }
    if (!hasUndepositedLines && validOther.length === 0) {
      setErr('Select at least one payment or add a fund line.'); return;
    }

    setBusy(true);
    try {
      const otherLns = validOther.map((l, i) => ({
        line_type: 'other_funds' as const,
        received_from: l.received_from || null,
        account_id: l.account_id,
        description: l.description || null,
        payment_method: l.payment_method || null,
        ref_no: l.ref_no || null,
        amount: String(parseFloat(l.amount)),
        sort_order: i,
      }));
      const cashBack = {
        cash_back_account_id: cashBackAccountId || null,
        cash_back_memo: cashBackMemo || null,
        cash_back_amount: cashBackNum > 0 ? String(cashBackNum) : null,
      };

      if (isNew) {
        const undepLines = selectedPayments.map((p, i) => ({
          line_type: 'undeposited_funds' as const,
          payment_id: p.id,
          received_from: p.customer_name,
          account_id: p.cash_account_id,
          description: p.memo ?? null,
          payment_method: p.payment_method,
          ref_no: p.reference ?? null,
          amount: p.amount,
          sort_order: i,
        }));
        const body = {
          bank_account_id: bankAccountId,
          deposit_date: depositDate,
          memo: memo || null,
          lines: [...undepLines, ...otherLns.map((l, i) => ({ ...l, sort_order: undepLines.length + i }))],
          ...cashBack,
        };
        const res = await api.post<{ id: string }>(`/businesses/${bizId}/bank-deposits`, body);
        invalidateReferenceCache(`/businesses/${bizId}/bank-accounts/${bankAccountId}`);
        // Files added before the deposit existed are uploaded now that it has an id.
        const failedAttach = await attachments.attachTo(res.data.id);
        attachments.reset();
        if (failedAttach) setErr(failedAttach);
        nav(`/accounting/bank-deposits/${res.data.id}`);
      } else {
        const body = {
          bank_account_id: bankAccountId,
          deposit_date: depositDate,
          memo: memo || null,
          lines: otherLns,
          ...cashBack,
        };
        await api.patch(`/businesses/${bizId}/bank-deposits/${id}`, body);
        invalidateReferenceCache(`/businesses/${bizId}/bank-accounts/${bankAccountId}`);
        await Promise.all([load(), loadBookBalance()]);
      }
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to save deposit.');
    } finally {
      setBusy(false);
    }
  }

  async function handleVoid() {
    if (!id || !bizId) return;
    if (!confirm('Are you sure you want to void this deposit? This will reverse the journal entry.')) return;
    setBusy(true);
    try {
      await api.post(`/businesses/${bizId}/bank-deposits/${id}/void`);
      await load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to void deposit.');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!id || !bizId) return;
    if (!confirm('Are you sure you want to delete this deposit? This cannot be undone.')) return;
    setBusy(true);
    try {
      await api.delete(`/businesses/${bizId}/bank-deposits/${id}`);
      nav('/accounting/bank-deposits');
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to delete deposit.');
    } finally {
      setBusy(false);
    }
  }

  async function buildDepositDocInput(): Promise<DepositDocInput> {
    if (!deposit || !bizId) throw new Error('Save the deposit first to print a deposit slip.');
    const bizRes = await cachedGet<{
      name: string;
      address: { line1?: string; line2?: string; city?: string; state?: string; postal_code?: string; country?: string } | null;
    }>(`/businesses/${bizId}`);
    const addr = bizRes.address;
    const cityZip = [[addr?.city, addr?.state].filter(Boolean).join(', '), addr?.postal_code].filter(Boolean).join(' ');
    const businessAddressLines = [addr?.line1, addr?.line2, cityZip || null, addr?.country].filter((l): l is string => !!l);

    const linesTotal = deposit.lines.reduce((s, l) => s + parseFloat(l.amount), 0);
    const cashBackAccountName = deposit.cash_back_account_id
      ? accounts.find(a => a.id === deposit.cash_back_account_id)?.name ?? null
      : null;

    return {
      depositNumber: deposit.deposit_number,
      depositDate: fmtDate(deposit.deposit_date),
      bankAccountName: deposit.bank_account_name,
      bankAccountLastFour: bankAccounts.find(b => b.id === deposit.bank_account_id)?.account_last_four ?? null,
      lines: deposit.lines.map(l => ({
        received_from: l.received_from ?? '',
        description: l.description ?? '',
        payment_method: l.payment_method ? l.payment_method.replace(/_/g, ' ') : '',
        ref_no: l.ref_no ?? '',
        amount: fmtMoney(l.amount),
      })),
      linesTotal: fmtMoney(linesTotal.toFixed(2)),
      cashBackAccountName,
      cashBackMemo: deposit.cash_back_memo,
      cashBackAmount: deposit.cash_back_amount ? fmtMoney(deposit.cash_back_amount) : null,
      netTotal: fmtMoney(deposit.total_amount),
      businessName: bizRes.name,
      businessAddressLines,
    };
  }

  // The preview opens inside the app (PdfPreviewHost), not in a new tab.
  async function handlePrintSlipAndSummary() {
    try {
      previewDepositSlipAndSummary(await buildDepositDocInput());
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to generate deposit slip.');
    }
  }

  async function handlePrintSummaryOnly() {
    try {
      previewDepositSummary(await buildDepositDocInput());
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to generate deposit slip.');
    }
  }

  function handlePrintAlignmentTest() {
    previewDepositAlignmentTest();
  }

  if (!bizId) return <div className="p-6">Pick a business.</div>;

  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col -mx-6 -my-6">
      {/* ── Title bar ── */}
      <div className="flex flex-wrap items-center gap-3 border-b bg-background px-6 py-4">
        <div className="relative">
          <button
            type="button"
            onClick={() => { void toggleRecent(); }}
            className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Recent deposits"
          >
            <History className="h-5 w-5" />
          </button>
          {recentOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setRecentOpen(false)} />
              <div className="absolute left-0 top-9 z-50 w-96 rounded-lg border bg-card shadow-xl">
                <div className="flex items-center justify-between border-b px-4 py-3">
                  <p className="text-sm font-semibold">Recent Deposits</p>
                  <button type="button" onClick={() => setRecentOpen(false)} className="rounded p-1 text-muted-foreground hover:bg-muted">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="max-h-80 overflow-y-auto py-1">
                  {recentDeposits === null ? (
                    <p className="px-4 py-3 text-sm text-muted-foreground">Loading…</p>
                  ) : recentDeposits.length === 0 ? (
                    <p className="px-4 py-3 text-sm text-muted-foreground">No deposits yet.</p>
                  ) : (
                    recentDeposits.map(d => (
                      <button
                        type="button"
                        key={d.id}
                        onClick={() => { setRecentOpen(false); nav(`/accounting/bank-deposits/${d.id}`); }}
                        className="grid w-full grid-cols-[1fr_5.5rem_6rem] items-center gap-2 px-4 py-2 text-left text-sm hover:bg-accent"
                      >
                        <span className="truncate text-primary">Bank Deposit</span>
                        <span className="whitespace-nowrap text-muted-foreground">{fmtDate(d.deposit_date)}</span>
                        <span className="text-right font-mono tabular-nums">{fmtMoney(d.total_amount)}</span>
                      </button>
                    ))
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => { setRecentOpen(false); nav('/accounting/transactions?type=deposit'); }}
                  className="block w-full border-t px-4 py-2.5 text-left text-sm text-primary hover:bg-accent"
                >
                  View More
                </button>
              </div>
            </>
          )}
        </div>
        <h1 className="text-xl font-semibold">
          Bank Deposit{deposit ? ` — ${deposit.deposit_number}` : ''}
        </h1>
        {deposit && deposit.voided_at && (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">Voided</span>
        )}
        {deposit && !deposit.voided_at && (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
            Posted
          </span>
        )}
        {deposit?.imported && (
          <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800">
            Imported
          </span>
        )}
        {deposit?.is_reconciled && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800" title="This deposit's payment has been reconciled">
            Reconciled
          </span>
        )}
      </div>

      {deposit?.is_reconciled && canEdit && (
        <div className="border-b border-amber-200 bg-amber-50 px-6 py-2 text-sm text-amber-900">
          This deposit has been reconciled. Editing it may require re-reconciling the affected bank statement.
        </div>
      )}

      {/* ── Header strip: Account · Date · AMOUNT ── */}
      <div className="flex items-end justify-between border-b bg-muted/10 px-6 pb-4 pt-5">
        <div className="flex flex-wrap items-end gap-8">
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Account
            </label>
            <div className="flex items-center gap-3">
              <AppSelect
                value={bankAccountId}
                onChange={e => setBankAccountId(e.target.value)}
                disabled={!canEdit}
                className="w-56"
              >
                {bankAccounts.map(ba => (
                  <option key={ba.id} value={ba.id}>{ba.name}</option>
                ))}
              </AppSelect>
              {selectedBankAccount && bookBalance !== null && (
                <span className="text-sm text-muted-foreground">
                  Balance {fmtMoney(bookBalance)}
                </span>
              )}
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Date
            </label>
            <DateInput
              value={depositDate}
              onChange={e => setDepositDate(e.target.value)}
              disabled={!canEdit}
              className="w-44"
            />
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Amount</p>
          <p className="text-4xl font-bold tabular-nums">{fmtMoney(netTotal.toFixed(2))}</p>
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-auto px-6 py-4">

        {/* ── Section 1: Undeposited Funds ── */}
        {(isNew ? undepositedPayments.length > 0 : deposit?.lines.some(l => l.line_type === 'undeposited_funds')) && (
          <div className="mb-6">
            <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
              <span className="text-muted-foreground">▼</span> Undeposited Funds
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-t">
                    {isNew && <th className="w-8 px-2 py-2.5" />}
                    <th className="px-2 py-2.5 text-left text-xs font-semibold text-muted-foreground">DATE</th>
                    <th className="px-2 py-2.5 text-left text-xs font-semibold text-muted-foreground">TYPE</th>
                    <th className="px-2 py-2.5 text-left text-xs font-semibold text-muted-foreground">RECEIVED FROM</th>
                    <th className="px-2 py-2.5 text-left text-xs font-semibold text-muted-foreground">ACCOUNT</th>
                    <th className="px-2 py-2.5 text-left text-xs font-semibold text-muted-foreground">PAYMENT METHOD</th>
                    <th className="px-2 py-2.5 text-left text-xs font-semibold text-muted-foreground">REF NO.</th>
                    <th className="px-2 py-2.5 text-right text-xs font-semibold text-muted-foreground">AMOUNT</th>
                  </tr>
                </thead>
                <tbody>
                  {isNew
                    ? undepositedPayments.map(p => {
                        const checked = selectedPaymentIds.has(p.id);
                        return (
                          <tr
                            key={p.id}
                            onClick={() => togglePayment(p.id)}
                            className={`cursor-pointer border-b transition-colors hover:bg-muted/40 ${checked ? 'bg-emerald-50' : ''}`}
                          >
                            <td className="px-2 py-2">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => togglePayment(p.id)}
                                onClick={e => e.stopPropagation()}
                                className="h-4 w-4 rounded border-input"
                              />
                            </td>
                            <td className="px-2 py-2">{fmtDate(p.payment_date)}</td>
                            <td className="px-2 py-2 capitalize text-muted-foreground">Payment</td>
                            <td className="px-2 py-2 font-medium">{p.customer_name}</td>
                            <td className="px-2 py-2 text-muted-foreground">{p.cash_account_code} {p.cash_account_name}</td>
                            <td className="px-2 py-2">{humanizeCode(p.payment_method)}</td>
                            <td className="px-2 py-2">{p.reference ?? '—'}</td>
                            <td className="px-2 py-2 text-right font-mono">{fmtMoney(p.amount)}</td>
                          </tr>
                        );
                      })
                    : deposit?.lines.filter(l => l.line_type === 'undeposited_funds').map(l => (
                        <tr key={l.id} className="border-b">
                          <td className="px-2 py-2">{fmtDate(deposit.deposit_date)}</td>
                          <td className="px-2 py-2 text-muted-foreground">Payment</td>
                          <td className="px-2 py-2 font-medium">{l.received_from ?? '—'}</td>
                          <td className="px-2 py-2 text-muted-foreground">{l.account_name ?? '—'}</td>
                          <td className="px-2 py-2 capitalize">{l.payment_method?.replace('_', ' ') ?? '—'}</td>
                          <td className="px-2 py-2">{l.ref_no ?? '—'}</td>
                          <td className="px-2 py-2 text-right font-mono">{fmtMoney(l.amount)}</td>
                        </tr>
                      ))
                  }
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Section 2: Other funds ── */}
        <div className="mb-4">
          <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
            <span className="text-muted-foreground">▼</span> Add funds to this deposit
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-t">
                  <th className="w-8 px-2 py-2.5 text-left text-xs font-semibold text-muted-foreground">#</th>
                  <th className="min-w-[130px] px-2 py-2.5 text-left text-xs font-semibold text-muted-foreground">RECEIVED FROM</th>
                  <th className="min-w-[180px] px-2 py-2.5 text-left text-xs font-semibold text-muted-foreground">ACCOUNT</th>
                  <th className="min-w-[150px] px-2 py-2.5 text-left text-xs font-semibold text-muted-foreground">DESCRIPTION</th>
                  <th className="w-36 px-2 py-2.5 text-left text-xs font-semibold text-muted-foreground">PAYMENT METHOD</th>
                  <th className="w-28 px-2 py-2.5 text-left text-xs font-semibold text-muted-foreground">REF NO.</th>
                  <th className="w-32 px-2 py-2.5 text-right text-xs font-semibold text-muted-foreground">AMOUNT</th>
                  <th className="w-10 px-2 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {otherLines.map((line, idx) => (
                  <tr key={line.id} className="group border-b transition-colors hover:bg-muted/40">
                    <td className="px-2 py-1.5 text-xs text-muted-foreground">{idx + 1}</td>
                    <td className="px-2 py-1.5">
                      <Input
                        value={line.received_from}
                        onChange={e => updateLine(idx, 'received_from', e.target.value)}
                        disabled={!canEdit}
                        list="deposit-contacts"
                        placeholder="Search customer or vendor…"
                        className="w-full"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <AccountSelect
                        accounts={accounts}
                        value={line.account_id}
                        onChange={v => updateLine(idx, 'account_id', v)}
                        disabled={!canEdit}
                        className="w-full"
                        placeholder=""
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input
                        value={line.description}
                        onChange={e => updateLine(idx, 'description', e.target.value)}
                        disabled={!canEdit}
                        className="w-full"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input
                        value={line.payment_method}
                        onChange={e => updateLine(idx, 'payment_method', e.target.value)}
                        disabled={!canEdit}
                        className="w-full"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input
                        value={line.ref_no}
                        onChange={e => updateLine(idx, 'ref_no', e.target.value)}
                        disabled={!canEdit}
                        className="w-full"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <MoneyInput
                        value={line.amount}
                        onChange={e => updateLine(idx, 'amount', e.target.value)}
                        disabled={!canEdit}
                        className="w-full text-right font-mono"
                        placeholder="0.00"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      {canEdit && (
                        <div className="flex items-center opacity-0 group-hover:opacity-100">
                          <button
                            type="button"
                            onClick={() => removeLine(idx)}
                            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
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

          {canEdit && (
            <div className="mt-3 flex gap-3">
              <button
                type="button"
                onClick={() => setOtherLines(prev => [...prev, emptyLine(prev.length)])}
                className="rounded border px-3 py-1.5 text-sm transition-colors hover:bg-muted/50"
              >
                Add lines
              </button>
              <button
                type="button"
                onClick={() => setOtherLines([emptyLine(0), emptyLine(1)])}
                className="rounded border px-3 py-1.5 text-sm transition-colors hover:bg-muted/50"
              >
                Clear all lines
              </button>
            </div>
          )}
        </div>

        {/* ── Bottom: Memo · Attachments left, Totals right ── */}
        <div className="mt-8 grid grid-cols-1 gap-8 md:grid-cols-2">
          <div>
            <label className="mb-2 block text-sm font-medium">Memo</label>
            <textarea
              value={memo}
              onChange={e => setMemo(e.target.value)}
              disabled={!canEdit}
              rows={4}
              className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
            />
            <AttachmentsPanel attachments={attachments} className="mt-4" />
          </div>

          <div className="flex flex-col gap-4">
            {/* Undeposited Funds subtotal — only relevant when the deposit actually has some */}
            {hasUndepositedLines && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Selected payments</span>
                <span className="font-mono font-medium">{fmtMoney(undepositedTotal.toFixed(2))}</span>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Other funds total</span>
              <span className="font-mono font-medium">{fmtMoney(otherTotal.toFixed(2))}</span>
            </div>

            {/* Cash back — plain labeled fields in a row, matching QBO's unboxed layout */}
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Cash back goes to</label>
                <AccountSelect
                  accounts={accounts}
                  value={cashBackAccountId}
                  onChange={setCashBackAccountId}
                  disabled={!canEdit}
                  placeholder="Choose an account"
                  className="w-full"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Cash back memo</label>
                <Input value={cashBackMemo} onChange={e => setCashBackMemo(e.target.value)} disabled={!canEdit} className="h-9" />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Cash back amount</label>
                <MoneyInput
                  value={cashBackAmount}
                  onChange={e => setCashBackAmount(e.target.value)}
                  disabled={!canEdit}
                  className="h-9 text-right font-mono"
                  placeholder="0.00"
                />
              </div>
            </div>

            <div className="flex justify-between border-t pt-3 text-base font-semibold">
              <span>Total</span>
              <span className="font-mono">{fmtMoney(netTotal.toFixed(2))}</span>
            </div>
          </div>
        </div>
      </div>

      {err && <p className="px-6 pb-2 text-sm text-destructive">{err}</p>}

      {/* ── Sticky bottom bar ── */}
      <div className="sticky -bottom-4 z-10 lg:-bottom-6 flex items-center gap-3 border-t bg-background px-6 py-3">
        <Button type="button" variant="outline" onClick={() => nav('/accounting/bank-transactions')}>
          Cancel
        </Button>

        <div className="mx-auto flex items-center gap-3 text-sm">
          <div className="relative">
            <button type="button" onClick={() => setPrintOpen(prev => !prev)} className="text-primary hover:underline">
              Print
            </button>
            {printOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setPrintOpen(false)} />
                <div className="absolute bottom-8 left-0 z-50 w-64 rounded-lg border bg-card shadow-xl">
                  <button
                    type="button"
                    onClick={() => { setPrintOpen(false); void handlePrintSlipAndSummary(); }}
                    className="flex w-full items-start px-4 py-2.5 text-left text-sm hover:bg-accent"
                  >
                    Print deposit slip and summary
                  </button>
                  <button
                    type="button"
                    onClick={() => { setPrintOpen(false); void handlePrintSummaryOnly(); }}
                    className="flex w-full items-start px-4 py-2.5 text-left text-sm hover:bg-accent"
                  >
                    Print deposit summary only
                  </button>
                  <button
                    type="button"
                    onClick={() => { setPrintOpen(false); handlePrintAlignmentTest(); }}
                    className="flex w-full items-start border-t px-4 py-2.5 text-left text-sm hover:bg-accent"
                  >
                    Setup and alignment
                  </button>
                </div>
              </>
            )}
          </div>
          {canEdit && (
            <>
              <span className="text-muted-foreground">·</span>
              <button
                type="button"
                className="text-primary hover:underline"
                onClick={() => setRecurringOpen(true)}
              >
                Make recurring
              </button>
            </>
          )}

          {!isNew && (
            <>
              <span className="text-muted-foreground">·</span>
              <div className="relative">
                <button type="button" onClick={() => setMoreOpen(prev => !prev)} className="text-primary hover:underline">
                  More
                </button>
                {moreOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setMoreOpen(false)} />
                    <div className="absolute bottom-8 left-0 z-50 w-52 rounded-lg border bg-card shadow-xl">
                      <button
                        type="button"
                        onClick={() => { setMoreOpen(false); handleCopy(); }}
                        className="flex w-full items-center gap-2 px-4 py-2.5 text-sm hover:bg-accent"
                      >
                        <Copy className="h-4 w-4" /> Copy
                      </button>
                      {canEdit && canVoid && (
                        <button
                          type="button"
                          onClick={() => { setMoreOpen(false); void handleVoid(); }}
                          className="flex w-full items-center gap-2 px-4 py-2.5 text-sm hover:bg-accent"
                        >
                          <X className="h-4 w-4" /> Void
                        </button>
                      )}
                      {canDelete && (
                        <button
                          type="button"
                          onClick={() => { setMoreOpen(false); void handleDelete(); }}
                          className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-destructive hover:bg-accent"
                        >
                          <Trash2 className="h-4 w-4" /> Delete
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => { setMoreOpen(false); if (deposit?.journal_entry_id) nav(`/journal/${deposit.journal_entry_id}`); }}
                        disabled={!deposit?.journal_entry_id}
                        className="flex w-full items-center gap-2 px-4 py-2.5 text-sm hover:bg-accent disabled:opacity-40"
                      >
                        <BookOpen className="h-4 w-4" /> Transaction journal
                      </button>
                      <button
                        type="button"
                        onClick={() => { setMoreOpen(false); setAuditOpen(true); }}
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

        {isNew && (
          <div className="relative flex">
            <Button type="button" disabled={busy} onClick={() => { void handleSave(); }} className="rounded-r-none">
              {busy ? 'Saving…' : 'Save and new'}
            </Button>
            <Button
              type="button"
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

        {!isNew && (
          <Button type="button" disabled={busy} onClick={() => { void handleSave(); }}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        )}
      </div>

      {auditOpen && bizId && id && !isNew && (
        <AuditHistoryModal url={`/businesses/${bizId}/bank-deposits/${id}/audit-history`} onClose={() => setAuditOpen(false)} />
      )}

      {/* ── Make Recurring Dialog ── */}
      {recurringOpen && bizId && (
        <RecurringDialog
          bankAccountId={bankAccountId}
          otherLines={otherLines}
          depositDate={depositDate}
          memo={memo}
          bizId={bizId}
          onClose={() => setRecurringOpen(false)}
          onSaved={() => { setRecurringOpen(false); alert('Recurring template saved.'); }}
        />
      )}

      <datalist id="deposit-contacts">
        {contactNames.map(name => <option key={name} value={name} />)}
      </datalist>
    </div>
  );
}
