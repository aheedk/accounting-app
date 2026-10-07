import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { hasMinRole } from '@accounting/shared';
import { BookOpen, ChevronDown, Clock, Copy, GripVertical, History, Printer, Trash2, X } from 'lucide-react';
import { api } from '@/lib/apiClient';
import { pickErr } from '@/lib/apiErrors';
import { cachedGet, invalidateReferenceCache } from '@/lib/referenceDataCache';
import { useActiveBusinessId } from '@/lib/business';
import { useAuth } from '@/auth/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DateInput } from '@/components/ui/date-input';
import { AccountSelect, type AccountLike } from '@/components/ui/AccountSelect';
import { useAddAccount } from '@/components/addNew/useAddAccount';
import { PartySelect, type Party } from '@/components/ui/PartySelect';
import { useAttachments, AttachmentsPanel } from '@/components/Attachments';
import { fmtMoney } from '@/lib/money';
import { todayLocal } from '@/lib/dates';
import { previewCheck } from '@/lib/download';

// ── Types ──────────────────────────────────────────────────────────────────

type CheckLine = {
  id: string;
  account_id: string;
  description: string;
  amount: string;
};

type CheckDetail = {
  id: string;
  check_number: string;
  payee_id: string | null;
  payee_type: 'vendor' | 'customer' | 'other' | null;
  payee_text: string | null;
  vendor_name: string | null;
  customer_name: string | null;
  payee_name: string | null;
  bank_account_id: string;
  bank_account_name: string;
  cash_account_code: string;
  cash_account_name: string;
  payment_date: string;
  mailing_address: string | null;
  memo: string | null;
  total_amount: string;
  print_later: boolean;
  is_printed: boolean;
  status: 'draft' | 'posted' | 'void';
  journal_entry_id: string | null;
  editable: boolean;
  is_reconciled: boolean;
  lines: Array<{ id: string; account_id: string; description: string | null; amount: string; account_name: string; account_code: string }>;
};

type RecentCheck = { id: string; payment_date: string; payee_name: string | null; total_amount: string; check_number: string };
type BankAccount = { id: string; name: string; cash_account_id: string; cash_account_name: string; cash_account_code: string; account_last_four: string | null };
type VendorWithAddress = {
  id: string; name: string;
  billing_address: { line1?: string; line2?: string; city?: string; state?: string; postal_code?: string; country?: string } | null;
};

// ── Helpers ────────────────────────────────────────────────────────────────

function emptyLine(idx: number): CheckLine {
  return { id: `new-${idx}`, account_id: '', description: '', amount: '' };
}

function fmtDate(iso: string) {
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y}`;
}

function fmtAddress(a: VendorWithAddress['billing_address']): string {
  if (!a) return '';
  const cityLine = [a.city, a.state, a.postal_code].filter(Boolean).join(', ');
  return [a.line1, a.line2, cityLine, a.country].filter(Boolean).join('\n');
}

// ── Make Recurring Dialog ──────────────────────────────────────────────────

type RecurrenceType = 'scheduled' | 'reminder' | 'unscheduled';
type IntervalType = 'daily' | 'weekly' | 'monthly' | 'yearly';

function RecurringDialog({
  payeeText, payeeId, payeeType, bankAccountId, mailingAddress, memo, lines,
  paymentDate, onClose, onSaved, bizId,
}: {
  payeeText: string;
  payeeId: string;
  payeeType: 'vendor' | 'customer' | '';
  bankAccountId: string;
  mailingAddress: string;
  memo: string;
  lines: CheckLine[];
  paymentDate: string;
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
    start_date: paymentDate,
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
        template_type: 'check',
        recurrence: recurrenceMap[form.interval_type],
        next_run_date: form.start_date || paymentDate,
        end_date: form.end_date || null,
        payload: {
          payee_text: payeeId ? null : (payeeText || null),
          payee_id: payeeId || null,
          payee_type: payeeType || null,
          bank_account_id: bankAccountId,
          mailing_address: mailingAddress || null,
          memo,
          recurrence_type: form.recurrence_type,
          interval_type: form.interval_type,
          interval_value: parseInt(form.interval_value) || 1,
          days_in_advance: parseInt(form.days_in_advance) || 0,
          lines: lines.filter(l => l.account_id && parseFloat(l.amount || '0') !== 0).map(l => ({
            account_id: l.account_id,
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
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recurring Check</p>
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
              <select
                value={form.recurrence_type}
                onChange={e => update({ recurrence_type: e.target.value as RecurrenceType })}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="scheduled">Scheduled</option>
                <option value="reminder">Reminder</option>
                <option value="unscheduled">Unscheduled</option>
              </select>
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
                  <select
                    value={form.interval_type}
                    onChange={e => update({ interval_type: e.target.value as IntervalType })}
                    className="h-9 w-32 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly</option>
                  </select>
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
  'check.create': 'Created',
  'check.update': 'Edited',
  'check.void': 'Voided',
  'check.delete': 'Deleted',
};

function AuditHistoryModal({ bizId, checkId, onClose }: { bizId: string; checkId: string; onClose: () => void }) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ history: AuditEntry[] }>(`/businesses/${bizId}/checks/${checkId}/audit-history`)
      .then(r => setEntries(r.data.history))
      .catch((e: unknown) => setErr(pickErr(e)));
  }, [bizId, checkId]);

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

export default function CheckPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = !id || id === 'new';
  const [searchParams] = useSearchParams();
  const [bizId] = useActiveBusinessId();
  const nav = useNavigate();
  const { user, businesses } = useAuth();
  const role = businesses.find(b => b.id === bizId)?.role_override ?? user?.role;

  const [accounts, setAccounts] = useState<AccountLike[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [vendors, setVendors] = useState<VendorWithAddress[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [bookBalance, setBookBalance] = useState<string | null>(null);
  const [check, setCheck] = useState<CheckDetail | null>(null);

  const [payeeId, setPayeeId] = useState('');
  const [payeeType, setPayeeType] = useState<'vendor' | 'customer' | ''>('');
  const [payeeText, setPayeeText] = useState('');
  const [mailingAddress, setMailingAddress] = useState('');

  const [bankAccountId, setBankAccountId] = useState('');
  const [paymentDate, setPaymentDate] = useState(todayLocal());
  const [checkNumber, setCheckNumber] = useState('');
  const [checkNumberEdited, setCheckNumberEdited] = useState(false);
  const [printLater, setPrintLater] = useState(false);
  const [memo, setMemo] = useState('');
  const [lines, setLines] = useState<CheckLine[]>([emptyLine(0), emptyLine(1)]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showSaveMenu, setShowSaveMenu] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [recurringOpen, setRecurringOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [recentOpen, setRecentOpen] = useState(false);
  const [recentChecks, setRecentChecks] = useState<RecentCheck[] | null>(null);

  const attachments = useAttachments('check', isNew ? null : (id ?? null));

  const categoryAccounts = [
    ...accounts.filter(a => a.account_type === 'expense'),
    ...accounts.filter(a => a.account_type !== 'expense'),
  ];
  const addAccount = useAddAccount(accounts, account => {
    setAccounts(prev => [...prev, account]);
    if (bizId) invalidateReferenceCache(`/businesses/${bizId}/coa`);
  });

  const load = useCallback(async () => {
    if (!bizId) return;
    const [coaData, custData, vendData, bankData] = await Promise.all([
      cachedGet<{ accounts: AccountLike[] }>(`/businesses/${bizId}/coa`),
      cachedGet<{ customers: Array<{ id: string; name: string }> }>(`/businesses/${bizId}/customers`),
      cachedGet<{ vendors: VendorWithAddress[] }>(`/businesses/${bizId}/vendors`),
      cachedGet<{ bank_accounts: BankAccount[] }>(`/businesses/${bizId}/bank-accounts`),
    ]);
    setAccounts(coaData?.accounts ?? []);
    setVendors(vendData?.vendors ?? []);
    setBankAccounts(bankData?.bank_accounts ?? []);
    setParties([
      ...(vendData?.vendors ?? []).map(v => ({ id: v.id, type: 'vendor' as const, name: v.name })),
      ...(custData?.customers ?? []).map(c => ({ id: c.id, type: 'customer' as const, name: c.name })),
    ]);

    if (!isNew && id) {
      const res = await api.get<CheckDetail>(`/businesses/${bizId}/checks/${id}`);
      const c = res.data;
      setCheck(c);
      if (c.payee_id && c.payee_type === 'vendor') { setPayeeId(c.payee_id); setPayeeType('vendor'); setPayeeText(''); }
      else if (c.payee_id && c.payee_type === 'customer') { setPayeeId(c.payee_id); setPayeeType('customer'); setPayeeText(''); }
      else { setPayeeId(''); setPayeeType(''); setPayeeText(c.payee_name ?? ''); }
      setMailingAddress(c.mailing_address ?? '');
      setBankAccountId(c.bank_account_id);
      setPaymentDate(c.payment_date);
      setCheckNumber(c.check_number);
      setCheckNumberEdited(true);
      setPrintLater(c.print_later);
      setMemo(c.memo ?? '');
      setLines(c.lines.length > 0
        ? c.lines.map(l => ({ id: l.id, account_id: l.account_id, description: l.description ?? '', amount: l.amount }))
        : [emptyLine(0), emptyLine(1)]);
    } else {
      // From a vendor's "Write check" action: pre-select them as payee.
      const vendorId = searchParams.get('vendorId') ?? searchParams.get('vendor_id');
      if (vendorId) {
        setPayeeId(vendorId);
        setPayeeType('vendor');
        setPayeeText('');
        const vendor = (vendData?.vendors ?? []).find(v => v.id === vendorId);
        if (vendor) setMailingAddress(fmtAddress(vendor.billing_address));
      }
    }
  }, [bizId, id, isNew]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void load(); }, [load]);

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

  // Auto-assign the next check number for this bank account — only on a new,
  // unsaved check, and only until the user types their own (pre-printed stock
  // that starts elsewhere).
  useEffect(() => {
    if (!isNew || !bizId || !bankAccountId || checkNumberEdited) return;
    api.get<{ check_number: string }>(`/businesses/${bizId}/checks/next-number`, { params: { bank_account_id: bankAccountId } })
      .then(r => setCheckNumber(r.data.check_number))
      .catch(() => {});
  }, [isNew, bizId, bankAccountId, checkNumberEdited]);

  async function toggleRecent() {
    if (recentOpen) { setRecentOpen(false); return; }
    setRecentOpen(true);
    if (recentChecks === null && bizId) {
      try {
        const res = await api.get<{ checks: RecentCheck[] }>(`/businesses/${bizId}/checks`);
        setRecentChecks((res.data.checks ?? []).slice(0, 10));
      } catch {
        setRecentChecks([]);
      }
    }
  }

  function pickParty(p: Party) {
    setPayeeId(p.id);
    setPayeeType(p.type);
    setPayeeText('');
    if (p.type === 'vendor') {
      const vendor = vendors.find(v => v.id === p.id);
      setMailingAddress(fmtAddress(vendor?.billing_address ?? null));
      // "Learned" category: the account this vendor's checks/expenses most
      // recently used, pre-filled onto the first (still-blank) line only.
      if (bizId) {
        api.get<{ account_id: string | null }>(`/businesses/${bizId}/checks/vendor-default-category`, { params: { vendor_id: p.id } })
          .then(r => {
            if (!r.data.account_id) return;
            setLines(prev => prev.map((l, i) => (i === 0 && !l.account_id ? { ...l, account_id: r.data.account_id! } : l)));
          })
          .catch(() => {});
      }
    }
  }
  function changePayeeText(text: string) {
    setPayeeId('');
    setPayeeType('');
    setPayeeText(text);
  }

  function updateLine(idx: number, field: keyof CheckLine, value: string) {
    setLines(prev => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l));
  }
  function duplicateLine(idx: number) {
    setLines(prev => {
      const copy = { ...prev[idx]!, id: `new-${Date.now()}` };
      const next = [...prev];
      next.splice(idx + 1, 0, copy);
      return next;
    });
  }
  function removeLine(idx: number) {
    setLines(prev => prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx));
  }
  function moveLine(targetIndex: number) {
    if (dragIndex === null || dragIndex === targetIndex) { setDragIndex(null); setOverIndex(null); return; }
    setLines(prev => {
      const next = [...prev];
      const moved = next.splice(dragIndex, 1)[0];
      if (!moved) return prev;
      next.splice(targetIndex, 0, moved);
      return next;
    });
    setDragIndex(null); setOverIndex(null);
  }

  const validLines = lines.filter(l => l.account_id && parseFloat(l.amount || '0') !== 0);
  const total = validLines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);
  const selectedBankAccount = bankAccounts.find(a => a.id === bankAccountId);
  const payeeDisplayName = payeeId ? (parties.find(p => p.id === payeeId)?.name ?? '') : payeeText;

  const canEdit = isNew || (check?.editable ?? true);
  const canVoid = role !== undefined && hasMinRole(role, 'accountant');
  const canDelete = role !== undefined && hasMinRole(role, 'firm_admin');

  async function handleSave(after?: 'close' | 'new') {
    setErr(null);
    if (!bankAccountId) { setErr('Please select a bank account.'); return; }
    if (!payeeId && !payeeText.trim()) { setErr('Please enter a payee.'); return; }
    if (validLines.length === 0) { setErr('Add at least one line.'); return; }

    setBusy(true);
    try {
      const body = {
        payment_date: paymentDate,
        check_number: checkNumberEdited ? (checkNumber.trim() || null) : null,
        payee_id: payeeId || null,
        payee_type: payeeId ? (payeeType || null) : null,
        payee_text: payeeId ? null : (payeeText.trim() || null),
        bank_account_id: bankAccountId,
        mailing_address: mailingAddress || null,
        memo: memo || null,
        print_later: printLater,
        lines: validLines.map(l => ({
          account_id: l.account_id,
          description: l.description || null,
          amount: String(parseFloat(l.amount)),
        })),
      };

      if (isNew) {
        const res = await api.post<{ id: string }>(`/businesses/${bizId}/checks`, body);
        const failedAttach = await attachments.attachTo(res.data.id);
        if (after === 'new') {
          attachments.reset();
          setCheck(null);
          setPayeeId(''); setPayeeType(''); setPayeeText(''); setMailingAddress('');
          setBankAccountId(''); setPaymentDate(todayLocal()); setCheckNumber(''); setCheckNumberEdited(false);
          setPrintLater(false); setMemo(''); setLines([emptyLine(0), emptyLine(1)]);
          if (failedAttach) setErr(failedAttach);
        } else {
          nav(`/accounting/checks/${res.data.id}`);
        }
      } else {
        await api.patch(`/businesses/${bizId}/checks/${id}`, body);
        invalidateReferenceCache(`/businesses/${bizId}/bank-accounts/${bankAccountId}`);
        if (after === 'close') nav('/accounting/checks');
        else if (after === 'new') nav('/accounting/checks/new');
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
    if (!confirm('Are you sure you want to void this check? This will reverse the journal entry.')) return;
    setBusy(true);
    try {
      await api.post(`/businesses/${bizId}/checks/${id}/void`);
      await load();
    } catch (e: unknown) {
      setErr(pickErr(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!id || !bizId) return;
    if (!confirm('Are you sure you want to delete this check? This cannot be undone.')) return;
    setBusy(true);
    try {
      await api.delete(`/businesses/${bizId}/checks/${id}`);
      nav('/accounting/checks');
    } catch (e: unknown) {
      setErr(pickErr(e));
    } finally {
      setBusy(false);
    }
  }

  function handleCopy() {
    const draft = {
      payeeId, payeeType, payeeText, mailingAddress,
      bankAccountId, memo,
      lines: validLines.map(l => ({ ...l })),
    };
    sessionStorage.setItem('check-copy-draft', JSON.stringify(draft));
    nav('/accounting/checks/new?copy=1');
  }

  // Pick up a copied draft dropped by handleCopy, once, on a fresh "new" form.
  useEffect(() => {
    if (!isNew) return;
    const raw = sessionStorage.getItem('check-copy-draft');
    if (!raw) return;
    sessionStorage.removeItem('check-copy-draft');
    try {
      const draft = JSON.parse(raw) as {
        payeeId: string; payeeType: 'vendor' | 'customer' | ''; payeeText: string; mailingAddress: string;
        bankAccountId: string; memo: string; lines: CheckLine[];
      };
      setPayeeId(draft.payeeId); setPayeeType(draft.payeeType); setPayeeText(draft.payeeText);
      setMailingAddress(draft.mailingAddress);
      setBankAccountId(draft.bankAccountId); setMemo(draft.memo);
      setLines(draft.lines.length > 0 ? draft.lines : [emptyLine(0), emptyLine(1)]);
      setPaymentDate(todayLocal());
      // A duplicated check gets the next number in the sequence, not the
      // original's own number — leave checkNumberEdited false so the
      // next-number effect assigns it once bankAccountId is set above.
      setCheckNumber(''); setCheckNumberEdited(false);
    } catch { /* ignore a malformed draft */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew]);

  function handlePrintCheck() {
    const lineRows = validLines.map(l => {
      const account = accounts.find(a => a.id === l.account_id);
      return {
        accountLabel: account ? `${account.code} ${account.name}` : '',
        description: l.description,
        amount: fmtMoney(l.amount),
      };
    });
    previewCheck({
      checkNumber: checkNumber || '—',
      paymentDate: fmtDate(paymentDate),
      payeeName: payeeDisplayName || '—',
      mailingAddress: mailingAddress.split('\n').filter(Boolean),
      amount: fmtMoney(total.toFixed(2)),
      bankAccountName: selectedBankAccount?.cash_account_name ?? selectedBankAccount?.name ?? '',
      bankAccountLastFour: selectedBankAccount?.account_last_four ?? null,
      memo: memo || null,
      lines: lineRows,
      businessName: businesses.find(b => b.id === bizId)?.name ?? '',
    });
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
            aria-label="Recent checks"
          >
            <History className="h-5 w-5" />
          </button>
          {recentOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setRecentOpen(false)} />
              <div className="absolute left-0 top-9 z-50 w-96 rounded-lg border bg-card shadow-xl">
                <div className="flex items-center justify-between border-b px-4 py-3">
                  <p className="text-sm font-semibold">Recent Checks</p>
                  <button type="button" onClick={() => setRecentOpen(false)} className="rounded p-1 text-muted-foreground hover:bg-muted">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="max-h-80 overflow-y-auto py-1">
                  {recentChecks === null ? (
                    <p className="px-4 py-3 text-sm text-muted-foreground">Loading…</p>
                  ) : recentChecks.length === 0 ? (
                    <p className="px-4 py-3 text-sm text-muted-foreground">No checks yet.</p>
                  ) : (
                    recentChecks.map(c => (
                      <button
                        type="button"
                        key={c.id}
                        onClick={() => { setRecentOpen(false); nav(`/accounting/checks/${c.id}`); }}
                        className="grid w-full grid-cols-[1fr_4rem_5.5rem_6rem] items-center gap-2 px-4 py-2 text-left text-sm hover:bg-accent"
                      >
                        <span className="truncate text-primary">{c.payee_name ?? 'Check'}</span>
                        <span className="whitespace-nowrap text-muted-foreground">#{c.check_number}</span>
                        <span className="whitespace-nowrap text-muted-foreground">{fmtDate(c.payment_date)}</span>
                        <span className="text-right font-mono tabular-nums">{fmtMoney(c.total_amount)}</span>
                      </button>
                    ))
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => { setRecentOpen(false); nav('/accounting/checks'); }}
                  className="block w-full border-t px-4 py-2.5 text-left text-sm text-primary hover:bg-accent"
                >
                  View More
                </button>
              </div>
            </>
          )}
        </div>
        <h1 className="text-xl font-semibold">Check{checkNumber ? ` #${checkNumber}` : ''}</h1>
        {check && check.status === 'void' && (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">Voided</span>
        )}
        {check && check.status === 'posted' && (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">Posted</span>
        )}
        {check && check.status === 'draft' && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">Draft</span>
        )}
        {check?.is_reconciled && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800" title="This check has been reconciled">
            Reconciled
          </span>
        )}
      </div>

      {check?.is_reconciled && canEdit && (
        <div className="border-b border-amber-200 bg-amber-50 px-6 py-2 text-sm text-amber-900">
          This check has been reconciled. Editing it may require re-reconciling the affected bank statement.
        </div>
      )}

      {/* ── Header strip ── */}
      <div className="flex flex-wrap items-start justify-between gap-6 border-b bg-muted/10 px-6 pb-4 pt-5">
        <div className="flex flex-1 flex-wrap items-start gap-6">
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
            <label className="mb-1 mt-4 block text-xs font-medium uppercase tracking-wide text-muted-foreground">Mailing address</label>
            <textarea
              value={mailingAddress}
              onChange={e => setMailingAddress(e.target.value)}
              disabled={!canEdit}
              rows={4}
              className="w-56 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>
          <div className="flex flex-col gap-6">
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground">Bank Account</label>
              <div className="flex items-center gap-3">
                <select
                  value={bankAccountId}
                  onChange={e => setBankAccountId(e.target.value)}
                  disabled={!canEdit}
                  className="h-9 w-56 rounded-md border border-input bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="">Choose an account</option>
                  {bankAccounts.map(ba => (
                    <option key={ba.id} value={ba.id}>{ba.cash_account_code} {ba.cash_account_name}</option>
                  ))}
                </select>
                {selectedBankAccount && bookBalance !== null && (
                  <span className="text-sm text-muted-foreground">Balance {fmtMoney(bookBalance)}</span>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-end gap-6">
              <div>
                <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground">Payment date</label>
                <DateInput value={paymentDate} onChange={e => setPaymentDate(e.target.value)} disabled={!canEdit} className="w-40" />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground">Check no.</label>
                <Input
                  value={checkNumber}
                  onChange={e => { setCheckNumber(e.target.value); setCheckNumberEdited(true); }}
                  disabled={!canEdit}
                  className="w-32"
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" checked={printLater} onChange={e => setPrintLater(e.target.checked)} disabled={!canEdit} className="h-4 w-4 rounded border" />
              Print later
            </label>
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
                  <th className="w-16 px-2 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {lines.map((line, idx) => (
                  <tr
                    key={line.id}
                    onDragOver={e => { if (canEdit) { e.preventDefault(); setOverIndex(idx); } }}
                    onDrop={() => { if (canEdit) moveLine(idx); }}
                    onDragEnd={() => { setDragIndex(null); setOverIndex(null); }}
                    className={[
                      'group border-b transition-colors hover:bg-muted/40',
                      dragIndex === idx ? 'opacity-40' : '',
                      overIndex === idx && dragIndex !== idx ? 'border-t-2 border-primary' : '',
                    ].join(' ')}
                  >
                    <td
                      className={`px-2 py-1.5 text-xs text-muted-foreground ${canEdit ? 'cursor-grab active:cursor-grabbing select-none' : ''}`}
                      {...(canEdit ? { draggable: true, onDragStart: () => setDragIndex(idx) } : {})}
                    >
                      <span className="flex items-center gap-1">
                        {canEdit && <GripVertical className="h-3.5 w-3.5 shrink-0" />}
                        {idx + 1}
                      </span>
                    </td>
                    <td className="px-2 py-1.5">
                      <AccountSelect
                        accounts={categoryAccounts}
                        value={line.account_id}
                        onChange={v => updateLine(idx, 'account_id', v)}
                        disabled={!canEdit}
                        className="w-full"
                        placeholder="Choose a category"
                        {...(canEdit ? { onCreate: () => addAccount.open({ accountType: 'expense', onPick: accId => updateLine(idx, 'account_id', accId) }) } : {})}
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
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
                          <button
                            type="button"
                            onClick={() => duplicateLine(idx)}
                            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                            aria-label="Duplicate line"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => removeLine(idx)}
                            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
                            aria-label="Delete line"
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
            <div className="mt-3 flex items-center justify-between">
              <div className="flex gap-3">
                <button type="button" onClick={() => setLines(prev => [...prev, emptyLine(prev.length)])} className="rounded border px-3 py-1.5 text-sm transition-colors hover:bg-muted/50">
                  Add lines
                </button>
                <button type="button" onClick={() => setLines([emptyLine(0), emptyLine(1)])} className="rounded border px-3 py-1.5 text-sm transition-colors hover:bg-muted/50">
                  Clear all lines
                </button>
              </div>
              <div className="text-base font-semibold">
                Total <span className="ml-3 font-mono">{fmtMoney(total.toFixed(2))}</span>
              </div>
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
        </div>
      </div>

      {err && <p className="px-6 pb-2 text-sm text-destructive">{err}</p>}

      {/* ── Sticky bottom bar ── */}
      <div className="sticky -bottom-4 z-10 lg:-bottom-6 flex items-center gap-3 border-t bg-background px-6 py-3">
        <Button type="button" variant="outline" onClick={() => nav('/accounting/checks')}>
          Cancel
        </Button>
        {canEdit && (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setPayeeId(''); setPayeeType(''); setPayeeText(''); setMailingAddress('');
              setBankAccountId(''); setPaymentDate(todayLocal()); setCheckNumber(''); setCheckNumberEdited(false);
              setPrintLater(false); setMemo(''); setLines([emptyLine(0), emptyLine(1)]);
              setErr(null);
            }}
          >
            Clear
          </Button>
        )}

        <div className="mx-auto flex items-center gap-3 text-sm">
          <button type="button" className="inline-flex items-center gap-1.5 text-primary hover:underline" onClick={handlePrintCheck}>
            <Printer className="h-3.5 w-3.5" /> Print check
          </button>
          <span className="text-muted-foreground">·</span>
          <button type="button" className="text-primary hover:underline" onClick={() => alert('Check ordering coming soon.')}>
            Order checks
          </button>
          {canEdit && (
            <>
              <span className="text-muted-foreground">·</span>
              <button type="button" className="text-primary hover:underline" onClick={() => setRecurringOpen(true)}>
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
                        onClick={() => { setMoreOpen(false); if (check?.journal_entry_id) nav(`/journal/${check.journal_entry_id}`); }}
                        disabled={!check?.journal_entry_id}
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
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={() => { void handleSave(); }}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
            <div className="relative flex">
              <Button type="button" disabled={busy} onClick={() => { void handleSave('close'); }} className="rounded-r-none">
                Save and close
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
                  <button type="button" className="w-full px-4 py-2.5 text-left text-sm hover:bg-accent" onClick={() => { setShowSaveMenu(false); void handleSave('new'); }}>
                    Save and new
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {addAccount.drawer}

      {recurringOpen && bizId && (
        <RecurringDialog
          payeeText={payeeText}
          payeeId={payeeId}
          payeeType={payeeType}
          bankAccountId={bankAccountId}
          mailingAddress={mailingAddress}
          memo={memo}
          lines={lines}
          paymentDate={paymentDate}
          bizId={bizId}
          onClose={() => setRecurringOpen(false)}
          onSaved={() => { setRecurringOpen(false); alert('Recurring template saved.'); }}
        />
      )}

      {auditOpen && bizId && id && (
        <AuditHistoryModal bizId={bizId} checkId={id} onClose={() => setAuditOpen(false)} />
      )}
    </div>
  );
}
