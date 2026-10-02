import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { hasMinRole } from '@accounting/shared';
import { BookOpen, ChevronDown, Clock, Copy, History, Trash2, X } from 'lucide-react';
import { api } from '@/lib/apiClient';
import { pickErr } from '@/lib/apiErrors';
import { cachedGet, invalidateReferenceCache } from '@/lib/referenceDataCache';
import { useActiveBusinessId } from '@/lib/business';
import { useAuth } from '@/auth/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DateInput } from '@/components/ui/date-input';
import { AccountSelect, type AccountLike } from '@/components/ui/AccountSelect';
import { AppSelect } from '@/components/ui/select';
import { PartySelect, type Party } from '@/components/ui/PartySelect';
import { useAttachments, AttachmentsPanel } from '@/components/Attachments';
import { fmtMoney } from '@/lib/money';
import { todayLocal } from '@/lib/dates';

// ── Types ──────────────────────────────────────────────────────────────────

type ExpenseLine = {
  id: string;
  category_account_id: string;
  description: string;
  amount: string;
};

type ExpenseDetail = {
  id: string;
  transaction_date: string;
  payee_text: string | null;
  vendor_id: string | null;
  customer_id: string | null;
  vendor_name: string | null;
  customer_name: string | null;
  payee_name: string | null;
  payment_account_id: string;
  payment_account_name: string;
  payment_method: string;
  reference: string | null;
  memo: string | null;
  total_amount: string;
  status: 'draft' | 'posted' | 'void';
  journal_entry_id: string | null;
  editable: boolean;
  imported: boolean;
  is_reconciled: boolean;
  lines: Array<{ id: string; category_account_id: string; description: string | null; amount: string; category_name: string; category_code: string }>;
};

type RecentExpense = { id: string; transaction_date: string; payee_name: string | null; total_amount: string };

const PAYMENT_METHODS: Array<{ value: string; label: string }> = [
  { value: 'cash', label: 'Cash' },
  { value: 'check', label: 'Check' },
  { value: 'credit_card', label: 'Credit Card' },
  { value: 'debit_card', label: 'Debit Card' },
  { value: 'ach', label: 'ACH/EFT' },
  { value: 'other', label: 'Other' },
];

// ── Helpers ────────────────────────────────────────────────────────────────

function emptyLine(idx: number): ExpenseLine {
  return { id: `new-${idx}`, category_account_id: '', description: '', amount: '' };
}

function fmtDate(iso: string) {
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y}`;
}

// ── Make Recurring Dialog ──────────────────────────────────────────────────

type RecurrenceType = 'scheduled' | 'reminder' | 'unscheduled';
type IntervalType = 'daily' | 'weekly' | 'monthly' | 'yearly';

function RecurringDialog({
  payeeText, vendorId, customerId, paymentAccountId, paymentMethod, reference, memo, lines,
  transactionDate, onClose, onSaved, bizId,
}: {
  payeeText: string;
  vendorId: string;
  customerId: string;
  paymentAccountId: string;
  paymentMethod: string;
  reference: string;
  memo: string;
  lines: ExpenseLine[];
  transactionDate: string;
  onClose: () => void;
  onSaved: () => void;
  bizId: string;
}) {
  const [form, setForm] = useState({
    name: '',
    recurrence_type: 'scheduled' as RecurrenceType,
    interval_type: 'monthly' as IntervalType,
    interval_value: '1',
    days_in_advance: '0',
    start_date: transactionDate,
    end_date: '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function update(patch: Partial<typeof form>) {
    setForm(prev => ({ ...prev, ...patch }));
  }

  const recurrenceMap: Record<IntervalType, 'weekly' | 'monthly' | 'quarterly' | 'yearly'> = {
    daily: 'weekly',
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
        template_type: 'expense',
        recurrence: recurrenceMap[form.interval_type],
        next_run_date: form.start_date || transactionDate,
        end_date: form.end_date || null,
        payload: {
          payee_text: payeeText || null,
          vendor_id: vendorId || null,
          customer_id: customerId || null,
          payment_account_id: paymentAccountId,
          payment_method: paymentMethod,
          reference: reference || null,
          memo,
          recurrence_type: form.recurrence_type,
          interval_type: form.interval_type,
          interval_value: parseInt(form.interval_value) || 1,
          days_in_advance: parseInt(form.days_in_advance) || 0,
          lines: lines.filter(l => l.category_account_id && parseFloat(l.amount || '0') !== 0).map(l => ({
            category_account_id: l.category_account_id,
            description: l.description || null,
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
        <div className="flex items-center justify-between border-b px-6 py-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recurring Expense</p>
          <button type="button" onClick={onClose} className="rounded p-1 hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5 px-6 py-5">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">Template name</label>
              <Input value={form.name} onChange={e => update({ name: e.target.value })} placeholder="Template name" className="h-9" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">Type</label>
              <AppSelect value={form.recurrence_type} onChange={e => update({ recurrence_type: e.target.value as RecurrenceType })} className="w-full">
                <option value="scheduled">Scheduled</option>
                <option value="reminder">Reminder</option>
                <option value="unscheduled">Unscheduled</option>
              </AppSelect>
            </div>
            {form.recurrence_type !== 'unscheduled' && (
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">Create days in advance</label>
                <div className="flex items-center gap-2">
                  <Input type="number" value={form.days_in_advance} onChange={e => update({ days_in_advance: e.target.value })} className="h-9 w-20" min="0" />
                  <span className="text-sm text-muted-foreground">days in advance</span>
                </div>
              </div>
            )}
          </div>

          {form.recurrence_type !== 'unscheduled' && (
            <>
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">Interval</label>
                  <AppSelect value={form.interval_type} onChange={e => update({ interval_type: e.target.value as IntervalType })} className="w-32">
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly</option>
                  </AppSelect>
                </div>
                <span className="pb-2 text-sm text-muted-foreground">of every</span>
                <div>
                  <Input type="number" value={form.interval_value} onChange={e => update({ interval_value: e.target.value })} className="h-9 w-20" min="1" />
                </div>
                <span className="pb-2 text-sm text-muted-foreground">{form.interval_type}(s)</span>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">Start date</label>
                  <DateInput value={form.start_date} onChange={e => update({ start_date: e.target.value })} className="w-full" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">End (optional)</label>
                  <DateInput value={form.end_date} onChange={e => update({ end_date: e.target.value })} className="w-full" />
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

// ── Audit History Modal ─────────────────────────────────────────────────────

type AuditEntry = { id: string; action: string; created_at: string; user_name: string | null; before: unknown; after: unknown };

const ACTION_LABELS: Record<string, string> = {
  'expense_transaction.create': 'Created',
  'expense_transaction.update': 'Edited',
  'expense_transaction.void': 'Voided',
  'expense_transaction.delete': 'Deleted',
};

function AuditHistoryModal({ bizId, expenseId, onClose }: { bizId: string; expenseId: string; onClose: () => void }) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ history: AuditEntry[] }>(`/businesses/${bizId}/expense-transactions/${expenseId}/audit-history`)
      .then(r => setEntries(r.data.history))
      .catch((e: unknown) => setErr(pickErr(e)));
  }, [bizId, expenseId]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-12">
      <div className="w-full max-w-3xl rounded-lg border bg-background shadow-2xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <p className="text-sm font-semibold">Audit History</p>
          <button type="button" onClick={onClose} className="rounded p-1 hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-6 py-4">
          {err && <p className="text-sm text-destructive">{err}</p>}
          {!err && entries === null && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!err && entries?.length === 0 && <p className="text-sm text-muted-foreground">No history yet.</p>}
          {entries && entries.length > 0 && (
            <ul className="space-y-4">
              {entries.map(entry => (
                <li key={entry.id} className="rounded-md border p-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{ACTION_LABELS[entry.action] ?? entry.action}</span>
                    <span className="text-muted-foreground">{new Date(entry.created_at).toLocaleString()}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{entry.user_name ?? 'System'}</p>
                  {(entry.before !== null || entry.after !== null) && (
                    <div className="mt-2 grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <p className="mb-1 font-medium text-muted-foreground">Before</p>
                        <pre className="max-h-40 overflow-auto rounded bg-muted/50 p-2">{entry.before ? JSON.stringify(entry.before, null, 2) : '—'}</pre>
                      </div>
                      <div>
                        <p className="mb-1 font-medium text-muted-foreground">After</p>
                        <pre className="max-h-40 overflow-auto rounded bg-muted/50 p-2">{entry.after ? JSON.stringify(entry.after, null, 2) : '—'}</pre>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────

export default function ExpensePage() {
  const { id } = useParams<{ id: string }>();
  const isNew = !id || id === 'new';
  const [bizId] = useActiveBusinessId();
  const nav = useNavigate();
  const { user, businesses } = useAuth();
  const role = businesses.find(b => b.id === bizId)?.role_override ?? user?.role;

  const [accounts, setAccounts] = useState<AccountLike[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [bookBalance, setBookBalance] = useState<string | null>(null);
  const [expense, setExpense] = useState<ExpenseDetail | null>(null);

  // Payee: either a picked party (vendorId/customerId set) or free text.
  const [payeeId, setPayeeId] = useState('');
  const [payeeType, setPayeeType] = useState<'vendor' | 'customer' | ''>('');
  const [payeeText, setPayeeText] = useState('');

  const [paymentAccountId, setPaymentAccountId] = useState('');
  const [transactionDate, setTransactionDate] = useState(todayLocal());
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [reference, setReference] = useState('');
  const [memo, setMemo] = useState('');
  const [lines, setLines] = useState<ExpenseLine[]>([emptyLine(0), emptyLine(1)]);

  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showSaveMenu, setShowSaveMenu] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [recurringOpen, setRecurringOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [recentOpen, setRecentOpen] = useState(false);
  const [recentExpenses, setRecentExpenses] = useState<RecentExpense[] | null>(null);

  const attachments = useAttachments('expense_transaction', isNew ? null : (id ?? null));

  const paymentAccounts = accounts.filter(a => a.account_type === 'asset' || a.account_type === 'liability');

  const load = useCallback(async () => {
    if (!bizId) return;
    const [coaData, custData, vendData] = await Promise.all([
      cachedGet<{ accounts: AccountLike[] }>(`/businesses/${bizId}/coa`),
      cachedGet<{ customers: Array<{ id: string; name: string }> }>(`/businesses/${bizId}/customers`),
      cachedGet<{ vendors: Array<{ id: string; name: string }> }>(`/businesses/${bizId}/vendors`),
    ]);
    setAccounts(coaData?.accounts ?? []);
    setParties([
      ...(vendData?.vendors ?? []).map(v => ({ id: v.id, type: 'vendor' as const, name: v.name })),
      ...(custData?.customers ?? []).map(c => ({ id: c.id, type: 'customer' as const, name: c.name })),
    ]);

    if (!isNew && id) {
      const res = await api.get<ExpenseDetail>(`/businesses/${bizId}/expense-transactions/${id}`);
      const e = res.data;
      setExpense(e);
      if (e.vendor_id) { setPayeeId(e.vendor_id); setPayeeType('vendor'); setPayeeText(''); }
      else if (e.customer_id) { setPayeeId(e.customer_id); setPayeeType('customer'); setPayeeText(''); }
      else { setPayeeId(''); setPayeeType(''); setPayeeText(e.payee_text ?? ''); }
      setPaymentAccountId(e.payment_account_id);
      setTransactionDate(e.transaction_date);
      setPaymentMethod(e.payment_method);
      setReference(e.reference ?? '');
      setMemo(e.memo ?? '');
      setLines(e.lines.length > 0
        ? e.lines.map(l => ({ id: l.id, category_account_id: l.category_account_id, description: l.description ?? '', amount: l.amount }))
        : [emptyLine(0), emptyLine(1)]);
    }
  }, [bizId, id, isNew]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void load(); }, [load]);

  const loadBookBalance = useCallback(async () => {
    if (!bizId || !paymentAccountId) { setBookBalance(null); return; }
    try {
      const data = await cachedGet<{ balance: string }>(`/businesses/${bizId}/coa/${paymentAccountId}`, 15_000);
      setBookBalance(data.balance);
    } catch {
      setBookBalance(null);
    }
  }, [bizId, paymentAccountId]);

  useEffect(() => { void loadBookBalance(); }, [loadBookBalance]);

  async function toggleRecent() {
    if (recentOpen) { setRecentOpen(false); return; }
    setRecentOpen(true);
    if (recentExpenses === null && bizId) {
      try {
        const res = await api.get<{ expense_transactions: RecentExpense[] }>(`/businesses/${bizId}/expense-transactions`);
        setRecentExpenses((res.data.expense_transactions ?? []).slice(0, 10));
      } catch {
        setRecentExpenses([]);
      }
    }
  }

  function pickParty(p: Party) {
    setPayeeId(p.id);
    setPayeeType(p.type);
    setPayeeText('');
  }
  function changePayeeText(text: string) {
    setPayeeId('');
    setPayeeType('');
    setPayeeText(text);
  }

  function updateLine(idx: number, field: keyof ExpenseLine, value: string) {
    setLines(prev => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l));
  }
  function removeLine(idx: number) {
    setLines(prev => prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx));
  }

  const validLines = lines.filter(l => l.category_account_id && parseFloat(l.amount || '0') !== 0);
  const total = validLines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);
  const selectedPaymentAccount = accounts.find(a => a.id === paymentAccountId);

  // Voided expenses are read-only, same as a posted deposit always stays editable
  // in place — the difference here is void is a real terminal state, not just
  // an "imported, correct it elsewhere" badge.
  const canEdit = isNew || (expense?.editable ?? true);
  const canVoid = role !== undefined && hasMinRole(role, 'accountant');
  const canDelete = role !== undefined && hasMinRole(role, 'firm_admin');

  async function handleSave(after?: 'close' | 'new') {
    setErr(null);
    if (!paymentAccountId) { setErr('Please select a payment account.'); return; }
    if (!payeeId && !payeeText.trim()) { setErr('Please enter a payee.'); return; }
    if (validLines.length === 0) { setErr('Add at least one line.'); return; }

    setBusy(true);
    try {
      const body = {
        transaction_date: transactionDate,
        payee_text: payeeId ? null : (payeeText.trim() || null),
        vendor_id: payeeType === 'vendor' ? payeeId : null,
        customer_id: payeeType === 'customer' ? payeeId : null,
        payment_account_id: paymentAccountId,
        payment_method: paymentMethod,
        reference: reference.trim() || null,
        memo: memo || null,
        lines: validLines.map((l, i) => ({
          category_account_id: l.category_account_id,
          description: l.description || null,
          amount: String(parseFloat(l.amount)),
          sort_order: i,
        })),
      };

      if (isNew) {
        const res = await api.post<{ id: string }>(`/businesses/${bizId}/expense-transactions`, body);
        const failedAttach = await attachments.attachTo(res.data.id);
        if (after === 'new') {
          attachments.reset();
          setExpense(null);
          setPayeeId(''); setPayeeType(''); setPayeeText('');
          setPaymentAccountId(''); setTransactionDate(todayLocal()); setPaymentMethod('cash');
          setReference(''); setMemo(''); setLines([emptyLine(0), emptyLine(1)]);
          if (failedAttach) setErr(failedAttach);
        } else {
          nav(`/accounting/expenses/${res.data.id}`);
        }
      } else {
        await api.patch(`/businesses/${bizId}/expense-transactions/${id}`, body);
        invalidateReferenceCache(`/businesses/${bizId}/coa/${paymentAccountId}`);
        if (after === 'close') nav('/accounting/expense-transactions');
        else if (after === 'new') nav('/accounting/expenses/new');
        else await Promise.all([load(), loadBookBalance()]);
      }
    } catch (e: unknown) {
      setErr(pickErr(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleVoid() {
    if (!id || !bizId) return;
    if (!confirm('Are you sure you want to void this expense? This will reverse the journal entry.')) return;
    setBusy(true);
    try {
      await api.post(`/businesses/${bizId}/expense-transactions/${id}/void`);
      await load();
    } catch (e: unknown) {
      setErr(pickErr(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!id || !bizId) return;
    if (!confirm('Are you sure you want to delete this expense? This cannot be undone.')) return;
    setBusy(true);
    try {
      await api.delete(`/businesses/${bizId}/expense-transactions/${id}`);
      nav('/accounting/expense-transactions');
    } catch (e: unknown) {
      setErr(pickErr(e));
    } finally {
      setBusy(false);
    }
  }

  function handleCopy() {
    const draft = {
      payeeId, payeeType, payeeText,
      paymentAccountId, paymentMethod,
      memo,
      lines: validLines.map(l => ({ ...l })),
    };
    sessionStorage.setItem('expense-copy-draft', JSON.stringify(draft));
    nav('/accounting/expenses/new?copy=1');
  }

  // Pick up a copied draft dropped by handleCopy, once, on a fresh "new" form.
  useEffect(() => {
    if (!isNew) return;
    const raw = sessionStorage.getItem('expense-copy-draft');
    if (!raw) return;
    sessionStorage.removeItem('expense-copy-draft');
    try {
      const draft = JSON.parse(raw) as {
        payeeId: string; payeeType: 'vendor' | 'customer' | ''; payeeText: string;
        paymentAccountId: string; paymentMethod: string; memo: string; lines: ExpenseLine[];
      };
      setPayeeId(draft.payeeId); setPayeeType(draft.payeeType); setPayeeText(draft.payeeText);
      setPaymentAccountId(draft.paymentAccountId); setPaymentMethod(draft.paymentMethod);
      setMemo(draft.memo);
      setLines(draft.lines.length > 0 ? draft.lines : [emptyLine(0), emptyLine(1)]);
      setTransactionDate(todayLocal());
      setReference('');
    } catch { /* ignore a malformed draft */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew]);

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
            aria-label="Recent expenses"
          >
            <History className="h-5 w-5" />
          </button>
          {recentOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setRecentOpen(false)} />
              <div className="absolute left-0 top-9 z-50 w-96 rounded-lg border bg-card shadow-xl">
                <div className="flex items-center justify-between border-b px-4 py-3">
                  <p className="text-sm font-semibold">Recent Expenses</p>
                  <button type="button" onClick={() => setRecentOpen(false)} className="rounded p-1 text-muted-foreground hover:bg-muted">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="max-h-80 overflow-y-auto py-1">
                  {recentExpenses === null ? (
                    <p className="px-4 py-3 text-sm text-muted-foreground">Loading…</p>
                  ) : recentExpenses.length === 0 ? (
                    <p className="px-4 py-3 text-sm text-muted-foreground">No expenses yet.</p>
                  ) : (
                    recentExpenses.map(e => (
                      <button
                        type="button"
                        key={e.id}
                        onClick={() => { setRecentOpen(false); nav(`/accounting/expenses/${e.id}`); }}
                        className="grid w-full grid-cols-[1fr_5.5rem_6rem] items-center gap-2 px-4 py-2 text-left text-sm hover:bg-accent"
                      >
                        <span className="truncate text-primary">{e.payee_name ?? 'Expense'}</span>
                        <span className="whitespace-nowrap text-muted-foreground">{fmtDate(e.transaction_date)}</span>
                        <span className="text-right font-mono tabular-nums">{fmtMoney(e.total_amount)}</span>
                      </button>
                    ))
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => { setRecentOpen(false); nav('/accounting/expense-transactions'); }}
                  className="block w-full border-t px-4 py-2.5 text-left text-sm text-primary hover:bg-accent"
                >
                  View More
                </button>
              </div>
            </>
          )}
        </div>
        <h1 className="text-xl font-semibold">Expense</h1>
        {expense && expense.status === 'void' && (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">Voided</span>
        )}
        {expense && expense.status === 'posted' && (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">Posted</span>
        )}
        {expense && expense.status === 'draft' && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">Draft</span>
        )}
        {expense?.imported && (
          <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800">
            Imported
          </span>
        )}
        {expense?.is_reconciled && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800" title="This expense's payment has been reconciled">
            Reconciled
          </span>
        )}
      </div>

      {expense?.is_reconciled && canEdit && (
        <div className="border-b border-amber-200 bg-amber-50 px-6 py-2 text-sm text-amber-900">
          This expense has been reconciled. Editing it may require re-reconciling the affected bank statement.
        </div>
      )}

      {/* ── Header strip ── */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b bg-muted/10 px-6 pb-4 pt-5">
        <div className="flex flex-wrap items-end gap-6">
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground">Payee</label>
            <PartySelect
              parties={parties}
              value={payeeId}
              text={payeeText}
              onPick={pickParty}
              onTextChange={changePayeeText}
              disabled={!canEdit}
              className="w-56"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground">Payment account</label>
            <div className="flex items-center gap-3">
              <AccountSelect
                accounts={paymentAccounts}
                value={paymentAccountId}
                onChange={setPaymentAccountId}
                disabled={!canEdit}
                placeholder="Choose an account"
                className="w-56"
              />
              {selectedPaymentAccount && bookBalance !== null && (
                <span className="text-sm text-muted-foreground">Balance {fmtMoney(bookBalance)}</span>
              )}
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground">Payment date</label>
            <DateInput value={transactionDate} onChange={e => setTransactionDate(e.target.value)} disabled={!canEdit} className="w-40" />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground">Payment method</label>
            <AppSelect value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)} disabled={!canEdit} className="w-40">
              {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </AppSelect>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground">Ref no.</label>
            <Input value={reference} onChange={e => setReference(e.target.value)} disabled={!canEdit} className="w-32" />
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Amount</p>
          <p className="text-4xl font-bold tabular-nums">{fmtMoney(total.toFixed(2))}</p>
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-auto px-6 py-4">
        <div className="mb-4">
          <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
            <span className="text-muted-foreground">▼</span> Category details
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-t">
                  <th className="w-8 px-2 py-2.5 text-left text-xs font-semibold text-muted-foreground">#</th>
                  <th className="min-w-[200px] px-2 py-2.5 text-left text-xs font-semibold text-muted-foreground">CATEGORY</th>
                  <th className="min-w-[200px] px-2 py-2.5 text-left text-xs font-semibold text-muted-foreground">DESCRIPTION</th>
                  <th className="w-36 px-2 py-2.5 text-right text-xs font-semibold text-muted-foreground">AMOUNT</th>
                  <th className="w-10 px-2 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {lines.map((line, idx) => (
                  <tr key={line.id} className="group border-b transition-colors hover:bg-muted/40">
                    <td className="px-2 py-1.5 text-xs text-muted-foreground">{idx + 1}</td>
                    <td className="px-2 py-1.5">
                      <AccountSelect
                        accounts={accounts}
                        value={line.category_account_id}
                        onChange={v => updateLine(idx, 'category_account_id', v)}
                        disabled={!canEdit}
                        className="w-full"
                        placeholder="Choose a category"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input value={line.description} onChange={e => updateLine(idx, 'description', e.target.value)} disabled={!canEdit} className="w-full" />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input
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
              <button type="button" onClick={() => setLines(prev => [...prev, emptyLine(prev.length)])} className="rounded border px-3 py-1.5 text-sm transition-colors hover:bg-muted/50">
                Add lines
              </button>
              <button type="button" onClick={() => setLines([emptyLine(0), emptyLine(1)])} className="rounded border px-3 py-1.5 text-sm transition-colors hover:bg-muted/50">
                Clear all lines
              </button>
            </div>
          )}
        </div>

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
            <div className="flex justify-between border-t pt-3 text-base font-semibold">
              <span>Total</span>
              <span className="font-mono">{fmtMoney(total.toFixed(2))}</span>
            </div>
          </div>
        </div>
      </div>

      {err && <p className="px-6 pb-2 text-sm text-destructive">{err}</p>}

      {/* ── Sticky bottom bar ── */}
      <div className="sticky bottom-0 flex items-center gap-3 border-t bg-background px-6 py-3">
        <Button type="button" variant="outline" onClick={() => nav('/accounting/expense-transactions')}>
          Cancel
        </Button>

        <div className="mx-auto flex items-center gap-3 text-sm">
          {canEdit && (
            <button type="button" className="text-primary hover:underline" onClick={() => setRecurringOpen(true)}>
              Make recurring
            </button>
          )}

          {!isNew && (
            <>
              {canEdit && <span className="text-muted-foreground">·</span>}
              <div className="relative">
                <button type="button" onClick={() => setMoreOpen(prev => !prev)} className="text-primary hover:underline">
                  More
                </button>
                {moreOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setMoreOpen(false)} />
                    <div className="absolute bottom-8 left-0 z-50 w-56 rounded-lg border bg-card shadow-xl">
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
                        onClick={() => { setMoreOpen(false); if (expense?.journal_entry_id) nav(`/journal/${expense.journal_entry_id}`); }}
                        disabled={!expense?.journal_entry_id}
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

        {canEdit && (
          <div className="relative flex">
            <Button type="button" disabled={busy} onClick={() => { void handleSave(); }} className="rounded-r-none">
              {busy ? 'Saving…' : 'Save'}
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
                <button type="button" className="w-full px-4 py-2.5 text-left text-sm hover:bg-accent" onClick={() => { setShowSaveMenu(false); void handleSave('close'); }}>
                  Save and close
                </button>
                <button type="button" className="w-full px-4 py-2.5 text-left text-sm hover:bg-accent" onClick={() => { setShowSaveMenu(false); void handleSave('new'); }}>
                  Save and new
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {recurringOpen && bizId && (
        <RecurringDialog
          payeeText={payeeText}
          vendorId={payeeType === 'vendor' ? payeeId : ''}
          customerId={payeeType === 'customer' ? payeeId : ''}
          paymentAccountId={paymentAccountId}
          paymentMethod={paymentMethod}
          reference={reference}
          memo={memo}
          lines={lines}
          transactionDate={transactionDate}
          bizId={bizId}
          onClose={() => setRecurringOpen(false)}
          onSaved={() => { setRecurringOpen(false); alert('Recurring template saved.'); }}
        />
      )}

      {auditOpen && bizId && id && (
        <AuditHistoryModal bizId={bizId} expenseId={id} onClose={() => setAuditOpen(false)} />
      )}
    </div>
  );
}
