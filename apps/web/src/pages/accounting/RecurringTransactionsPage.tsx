import { useEffect, useMemo, useState } from 'react';
import { FileDown, Printer } from 'lucide-react';
import { DateInput } from '@/components/ui/date-input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useActiveBusinessId } from '@/lib/business';
import { api } from '@/lib/apiClient';
import { fmtMoney, parseMoneyInput } from '@/lib/money';
import { todayLocal, fmtLongDate } from '@/lib/dates';
import { downloadAsExcel } from '@/lib/download';

type Account = { id: string; code: string; name: string; account_type: string };
type Customer = { id: string; name: string };
type Vendor = { id: string; name: string };

type Recurrence = 'weekly' | 'monthly' | 'quarterly' | 'yearly';
type TemplateType = 'journal_entry' | 'invoice' | 'bill';

type Template = {
  id: string;
  business_id: string;
  name: string;
  template_type: TemplateType;
  payload: unknown;
  recurrence: Recurrence;
  next_run_date: string;
  end_date: string | null;
  last_run_at: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type TemplateRun = { at: string; runs_created: number; advanced_to: string };

type RunDueResult = {
  results: Array<{ template_id: string; runs_created: number }>;
};

type JeLine = { account_id: string; debit: string; credit: string; memo: string };
type DocLine = { description: string; quantity: string; unit_price: string; account_id: string };

const blankJeLine = (): JeLine => ({ account_id: '', debit: '0.00', credit: '0.00', memo: '' });
const blankDocLine = (): DocLine => ({ description: '', quantity: '1', unit_price: '0.00', account_id: '' });

const blankForm = () => ({
  name: '',
  template_type: 'journal_entry' as TemplateType,
  recurrence: 'monthly' as Recurrence,
  next_run_date: todayLocal(),
  end_date: '',
  memo: '',
  reference: '',
  customer_id: '',
  vendor_id: '',
  due_days: '30',
});

function pickErr(e: unknown): string {
  return (
    (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data
      ?.error?.message ?? 'Failed'
  );
}

const INTERVAL_LABELS: Record<Recurrence, string> = {
  weekly: 'Every Week',
  monthly: 'Every Month',
  quarterly: 'Every Quarter',
  yearly: 'Every Year',
};

const TXN_TYPE_LABELS: Record<TemplateType, string> = {
  bill: 'Bill',
  invoice: 'Invoice',
  journal_entry: 'Journal Entry',
};

const TXN_TYPE_OPTIONS: Array<{ value: TemplateType; label: string }> = [
  { value: 'journal_entry', label: 'Journal Entry' },
  { value: 'invoice', label: 'Invoice' },
  { value: 'bill', label: 'Bill' },
];

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
}

// Mirrors the server's advanceDate so previews match what runDue will do.
function advance(date: string, recurrence: Recurrence): string {
  const d = new Date(date + 'T00:00:00Z');
  switch (recurrence) {
    case 'weekly': d.setUTCDate(d.getUTCDate() + 7); break;
    case 'monthly': d.setUTCMonth(d.getUTCMonth() + 1); break;
    case 'quarterly': d.setUTCMonth(d.getUTCMonth() + 3); break;
    case 'yearly': d.setUTCFullYear(d.getUTCFullYear() + 1); break;
  }
  return d.toISOString().slice(0, 10);
}

function nextDates(
  t: { next_run_date: string; recurrence: Recurrence; end_date: string | null }, n = 3,
): string[] {
  const out: string[] = [];
  let cur = t.next_run_date;
  for (let i = 0; i < n; i++) {
    if (t.end_date && cur > t.end_date) break;
    out.push(cur);
    cur = advance(cur, t.recurrence);
  }
  return out;
}

function templateAmount(t: Template): number {
  const p = t.payload as {
    lines?: Array<{ debit?: string; quantity?: string; unit_price?: string }>;
  } | null;
  if (!p?.lines) return 0;
  if (t.template_type === 'journal_entry') {
    return p.lines.reduce((s, l) => s + (parseFloat(l.debit ?? '0') || 0), 0);
  }
  return p.lines.reduce(
    (s, l) => s + (parseFloat(l.quantity ?? '0') || 0) * (parseFloat(l.unit_price ?? '0') || 0), 0,
  );
}

function templateParty(t: Template, customers: Customer[], vendors: Vendor[]): string {
  const p = t.payload as { customer_id?: string; vendor_id?: string } | null;
  if (t.template_type === 'invoice' && p?.customer_id) {
    return customers.find(c => c.id === p.customer_id)?.name ?? '—';
  }
  if (t.template_type === 'bill' && p?.vendor_id) {
    return vendors.find(v => v.id === p.vendor_id)?.name ?? '—';
  }
  return '—';
}

export default function RecurringTransactionsPage() {
  const [bizId] = useActiveBusinessId();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [runResult, setRunResult] = useState<string | null>(null);
  const [runErr, setRunErr] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const [form, setForm] = useState(blankForm());
  const [jeLines, setJeLines] = useState<JeLine[]>([blankJeLine(), blankJeLine()]);
  const [docLines, setDocLines] = useState<DocLine[]>([blankDocLine()]);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rowErr, setRowErr] = useState<string | null>(null);

  // Run-history expansion
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [runsCache, setRunsCache] = useState<Record<string, TemplateRun[] | 'loading'>>({});

  // Filter state
  const [nameFilter, setNameFilter] = useState('');
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [pendingTemplateType, setPendingTemplateType] = useState('');
  const [pendingTxnType, setPendingTxnType] = useState('');
  const [appliedTemplateType, setAppliedTemplateType] = useState('');
  const [appliedTxnType, setAppliedTxnType] = useState('');

  const [excelBusy, setExcelBusy] = useState(false);

  function reload() {
    if (!bizId) return;
    api
      .get<{ templates: Template[] }>(`/businesses/${bizId}/recurring-templates`)
      .then((r) => setTemplates(r.data.templates))
      .catch(() => undefined);
    api
      .get<{ accounts: Account[] }>(`/businesses/${bizId}/coa`)
      .then((r) => setAccounts(r.data.accounts))
      .catch(() => undefined);
    api
      .get<{ customers: Customer[] }>(`/businesses/${bizId}/customers`)
      .then((r) => setCustomers(r.data.customers))
      .catch(() => undefined);
    api
      .get<{ vendors: Vendor[] }>(`/businesses/${bizId}/vendors`)
      .then((r) => setVendors(r.data.vendors))
      .catch(() => undefined);
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bizId]);

  const filteredTemplates = useMemo(() => templates.filter(t => {
    if (nameFilter && !t.name.toLowerCase().includes(nameFilter.toLowerCase())) return false;
    if (appliedTemplateType && t.recurrence !== appliedTemplateType) return false;
    if (appliedTxnType && t.template_type !== appliedTxnType) return false;
    return true;
  }), [templates, nameFilter, appliedTemplateType, appliedTxnType]);

  const today = todayLocal();
  const due = useMemo(
    () => templates.filter((t) => t.is_active && t.next_run_date <= today),
    [templates, today],
  );

  const revenueAccounts = useMemo(() => accounts.filter(a => a.account_type === 'revenue'), [accounts]);
  const expenseAccounts = useMemo(() => accounts.filter(a => a.account_type === 'expense'), [accounts]);

  const totalD = jeLines.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0);
  const totalC = jeLines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
  const balanced = Math.abs(totalD - totalC) < 0.005 && totalD > 0;
  const docTotal = docLines.reduce((s, l) => s + (parseFloat(l.quantity) || 0) * (parseFloat(l.unit_price) || 0), 0);

  const isJe = form.template_type === 'journal_entry';
  const formPreview = nextDates(
    { next_run_date: form.next_run_date, recurrence: form.recurrence, end_date: form.end_date || null },
  );

  function resetForm() {
    setForm(blankForm());
    setJeLines([blankJeLine(), blankJeLine()]);
    setDocLines([blankDocLine()]);
    setFormErr(null);
  }

  function updateJeLine(i: number, patch: Partial<JeLine>) {
    setJeLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  function updateDocLine(i: number, patch: Partial<DocLine>) {
    setDocLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  function handleExport() {
    setExcelBusy(true);
    try {
      const headers = ['Template Name', 'Status', 'TXN Type', 'Interval', 'Previous Date', 'Next Date', 'Customer/Vendor', 'Amount'];
      const rows = filteredTemplates.map(t => [
        t.name,
        t.is_active ? 'Scheduled' : 'Paused',
        TXN_TYPE_LABELS[t.template_type] ?? t.template_type,
        INTERVAL_LABELS[t.recurrence] ?? t.recurrence,
        fmtDate(t.last_run_at),
        fmtDate(t.next_run_date),
        templateParty(t, customers, vendors),
        fmtMoney(templateAmount(t)),
      ]);
      downloadAsExcel(headers, rows, 'recurring-transactions');
    } finally {
      setExcelBusy(false);
    }
  }

  function handlePrint() {
    const rows = filteredTemplates.map(t => `
      <tr>
        <td>${t.name}</td>
        <td>${t.is_active ? 'Scheduled' : 'Paused'}</td>
        <td>${TXN_TYPE_LABELS[t.template_type] ?? t.template_type}</td>
        <td>${INTERVAL_LABELS[t.recurrence] ?? t.recurrence}</td>
        <td>${fmtDate(t.last_run_at)}</td>
        <td>${fmtDate(t.next_run_date)}</td>
        <td>${templateParty(t, customers, vendors)}</td>
        <td style="text-align:right">${fmtMoney(templateAmount(t))}</td>
      </tr>`).join('');
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><title>Recurring Transactions</title>
      <style>
        body { font-family: Arial, sans-serif; font-size: 11px; margin: 24px; }
        h2 { margin-bottom: 4px; }
        p { color: #666; font-size: 10px; margin-bottom: 16px; }
        table { width: 100%; border-collapse: collapse; }
        th { background: #f0f0f0; text-align: left; padding: 5px 7px; border-bottom: 2px solid #ccc; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; }
        td { padding: 4px 7px; border-bottom: 1px solid #e5e5e5; }
        tr:last-child td { border-bottom: none; }
      </style></head><body>
      <h2>Recurring Transactions</h2>
      <p>Generated ${new Date().toLocaleDateString()}</p>
      <table>
        <thead><tr><th>Template Name</th><th>Status</th><th>TXN Type</th><th>Interval</th><th>Previous Date</th><th>Next Date</th><th>Customer/Vendor</th><th>Amount</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <script>window.onload = function(){ window.print(); }${'</'}script>
    </body></html>`);
    win.document.close();
  }

  function applyFilter() {
    setAppliedTemplateType(pendingTemplateType);
    setAppliedTxnType(pendingTxnType);
    setShowFilterModal(false);
  }

  function resetFilter() {
    setPendingTemplateType('');
    setPendingTxnType('');
    setAppliedTemplateType('');
    setAppliedTxnType('');
    setNameFilter('');
  }

  const activeFilterCount = (appliedTemplateType ? 1 : 0) + (appliedTxnType ? 1 : 0);

  async function runDue() {
    if (!bizId) return;
    setRunning(true);
    setRunErr(null);
    setRunResult(null);
    try {
      const r = await api.post<RunDueResult>(
        `/businesses/${bizId}/recurring-templates/run-due`,
        {},
      );
      const total = r.data.results.reduce((s, x) => s + x.runs_created, 0);
      setRunResult(`Created ${total} entries across ${r.data.results.length} templates.`);
      setRunsCache({});
      reload();
    } catch (e: unknown) {
      setRunErr(pickErr(e));
    } finally {
      setRunning(false);
    }
  }

  async function deleteTemplate(id: string) {
    if (!bizId) return;
    if (!confirm('Delete this template?')) return;
    setRowErr(null);
    try {
      await api.delete(`/businesses/${bizId}/recurring-templates/${id}`);
      reload();
    } catch (e: unknown) {
      setRowErr(pickErr(e));
    }
  }

  async function togglePaused(t: Template) {
    if (!bizId) return;
    setRowErr(null);
    try {
      await api.patch(`/businesses/${bizId}/recurring-templates/${t.id}`, { is_active: !t.is_active });
      reload();
    } catch (e: unknown) {
      setRowErr(pickErr(e));
    }
  }

  async function toggleHistory(t: Template) {
    if (expandedId === t.id) { setExpandedId(null); return; }
    setExpandedId(t.id);
    if (!bizId || runsCache[t.id]) return;
    setRunsCache((c) => ({ ...c, [t.id]: 'loading' }));
    try {
      const r = await api.get<{ runs: TemplateRun[] }>(`/businesses/${bizId}/recurring-templates/${t.id}/runs`);
      setRunsCache((c) => ({ ...c, [t.id]: r.data.runs }));
    } catch {
      setRunsCache((c) => ({ ...c, [t.id]: [] }));
    }
  }

  function buildPayload(): { payload: object } | { error: string } {
    if (isJe) {
      for (let i = 0; i < jeLines.length; i++) {
        const l = jeLines[i]!;
        const d = parseFloat(l.debit) || 0;
        const c = parseFloat(l.credit) || 0;
        if (!l.account_id) return { error: `Line ${i + 1}: select an account.` };
        if (d > 0 && c > 0) return { error: `Line ${i + 1}: only one of debit or credit may be > 0.` };
        if (d === 0 && c === 0) return { error: `Line ${i + 1}: enter a debit or credit amount.` };
      }
      if (!balanced) return { error: 'Total debit must equal total credit.' };
      return {
        payload: {
          memo: form.memo || null,
          reference: form.reference || null,
          lines: jeLines.map((l) => ({
            account_id: l.account_id,
            debit: parseMoneyInput(l.debit || '0'),
            credit: parseMoneyInput(l.credit || '0'),
            memo: l.memo || null,
          })),
        },
      };
    }

    const isInvoice = form.template_type === 'invoice';
    if (isInvoice && !form.customer_id) return { error: 'Select a customer.' };
    if (!isInvoice && !form.vendor_id) return { error: 'Select a vendor.' };
    const dueDays = Number(form.due_days);
    if (!Number.isInteger(dueDays) || dueDays < 0 || dueDays > 365) {
      return { error: 'Due days must be a whole number between 0 and 365.' };
    }
    for (let i = 0; i < docLines.length; i++) {
      const l = docLines[i]!;
      if (!l.description.trim()) return { error: `Line ${i + 1}: enter a description.` };
      if (!((parseFloat(l.quantity) || 0) > 0)) return { error: `Line ${i + 1}: quantity must be > 0.` };
      if ((parseFloat(l.unit_price) || 0) < 0) return { error: `Line ${i + 1}: rate cannot be negative.` };
      if (!l.account_id) return { error: `Line ${i + 1}: select an account.` };
    }
    const lines = docLines.map((l) => (isInvoice
      ? {
        description: l.description.trim(),
        quantity: parseMoneyInput(l.quantity),
        unit_price: parseMoneyInput(l.unit_price || '0'),
        revenue_account_id: l.account_id,
        tax_code_id: null,
      }
      : {
        description: l.description.trim(),
        quantity: parseMoneyInput(l.quantity),
        unit_price: parseMoneyInput(l.unit_price || '0'),
        expense_account_id: l.account_id,
      }));
    return {
      payload: {
        ...(isInvoice ? { customer_id: form.customer_id } : { vendor_id: form.vendor_id }),
        due_days: dueDays,
        memo: form.memo || null,
        lines,
      },
    };
  }

  async function submitForm(e: React.FormEvent) {
    e.preventDefault();
    if (!bizId) return;
    setFormErr(null);

    const built = buildPayload();
    if ('error' in built) { setFormErr(built.error); return; }

    setBusy(true);
    try {
      await api.post(`/businesses/${bizId}/recurring-templates`, {
        name: form.name,
        template_type: form.template_type,
        payload: built.payload,
        recurrence: form.recurrence,
        next_run_date: form.next_run_date,
        end_date: form.end_date || null,
      });
      resetForm();
      setShowForm(false);
      reload();
    } catch (e: unknown) {
      setFormErr(pickErr(e));
    } finally {
      setBusy(false);
    }
  }

  if (!bizId) return <div>Pick a business.</div>;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Recurring Transactions</h1>
      </div>

      {/* Filter + icon toolbar */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Input
            placeholder="Filter by Name"
            value={nameFilter}
            onChange={e => setNameFilter(e.target.value)}
            className="w-52"
          />
          <Button
            variant="outline"
            onClick={() => { setPendingTemplateType(appliedTemplateType); setPendingTxnType(appliedTxnType); setShowFilterModal(true); }}
          >
            Filter{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
          </Button>
          {(nameFilter || activeFilterCount > 0) && (
            <button className="text-xs text-muted-foreground hover:text-foreground underline" onClick={resetFilter}>
              Clear
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative group">
            <button
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
              onClick={handleExport}
              disabled={excelBusy}
              aria-label="Export to Excel"
            >
              <FileDown className="h-4 w-4" />
            </button>
            <div className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
              Export to Excel
            </div>
          </div>
          <div className="relative group">
            <button
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              onClick={handlePrint}
              aria-label="Print"
            >
              <Printer className="h-4 w-4" />
            </button>
            <div className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
              Print
            </div>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Due now ({due.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {due.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing due today. Due templates also materialize automatically once a day.
            </p>
          ) : (
            <ul className="divide-y text-sm">
              {due.map((t) => (
                <li key={t.id} className="flex justify-between py-2">
                  <span>{t.name}</span>
                  <span className="text-muted-foreground">
                    <span className="capitalize">{t.recurrence}</span> — next <span className="font-mono">{fmtDate(t.next_run_date)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center gap-3 pt-2">
            <Button onClick={runDue} disabled={running || due.length === 0}>
              {running ? 'Running…' : 'Run all due'}
            </Button>
            {runResult && <span className="text-sm text-green-600">{runResult}</span>}
            {runErr && <span className="text-sm text-destructive">{runErr}</span>}
          </div>
        </CardContent>
      </Card>

      {rowErr && <p className="text-sm text-destructive">{rowErr}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>
              All templates{filteredTemplates.length !== templates.length ? ` (${filteredTemplates.length} of ${templates.length})` : ''}
            </span>
            <Button
              size="sm"
              onClick={() => { setShowForm((s) => !s); if (showForm) resetForm(); }}
            >
              {showForm ? 'Cancel' : '+ New template'}
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {showForm && (
            <form className="space-y-4 border rounded-md p-4" onSubmit={submitForm}>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="rt-name">Name</Label>
                  <Input id="rt-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
                </div>
                <div>
                  <Label htmlFor="rt-type">Transaction type</Label>
                  <select
                    id="rt-type"
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                    value={form.template_type}
                    onChange={(e) => setForm((f) => ({ ...f, template_type: e.target.value as TemplateType }))}
                    required
                  >
                    {TXN_TYPE_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="rt-recurrence">Recurrence</Label>
                  <select
                    id="rt-recurrence"
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                    value={form.recurrence}
                    onChange={(e) => setForm((f) => ({ ...f, recurrence: e.target.value as Recurrence }))}
                    required
                  >
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="yearly">Yearly</option>
                  </select>
                </div>
                <div>
                  <Label htmlFor="rt-next-run">Next run date</Label>
                  <DateInput id="rt-next-run" value={form.next_run_date} onChange={(e) => setForm((f) => ({ ...f, next_run_date: e.target.value }))} required />
                </div>
                <div>
                  <Label htmlFor="rt-end">End date (optional)</Label>
                  <DateInput id="rt-end" value={form.end_date} onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))} />
                </div>
                {isJe ? (
                  <div>
                    <Label htmlFor="rt-reference">Reference</Label>
                    <Input id="rt-reference" value={form.reference} onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))} />
                  </div>
                ) : (
                  <div>
                    <Label htmlFor="rt-due-days">Due days ({form.template_type === 'invoice' ? 'invoice' : 'bill'} due N days after each run)</Label>
                    <Input
                      id="rt-due-days"
                      type="number"
                      min="0"
                      max="365"
                      step="1"
                      value={form.due_days}
                      onChange={(e) => setForm((f) => ({ ...f, due_days: e.target.value }))}
                    />
                  </div>
                )}
                {form.template_type === 'invoice' && (
                  <div>
                    <Label htmlFor="rt-customer">Customer</Label>
                    <select
                      id="rt-customer"
                      className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                      value={form.customer_id}
                      onChange={(e) => setForm((f) => ({ ...f, customer_id: e.target.value }))}
                      required
                    >
                      <option value="">Select customer…</option>
                      {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                )}
                {form.template_type === 'bill' && (
                  <div>
                    <Label htmlFor="rt-vendor">Vendor</Label>
                    <select
                      id="rt-vendor"
                      className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                      value={form.vendor_id}
                      onChange={(e) => setForm((f) => ({ ...f, vendor_id: e.target.value }))}
                      required
                    >
                      <option value="">Select vendor…</option>
                      {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                    </select>
                  </div>
                )}
                <div className="col-span-2">
                  <Label htmlFor="rt-memo">Memo</Label>
                  <Input id="rt-memo" value={form.memo} onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))} />
                </div>
              </div>

              {formPreview.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Next runs: {formPreview.map(d => fmtLongDate(d)).join(' · ')}
                </p>
              )}

              {isJe ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Lines</Label>
                    <Button type="button" variant="outline" size="sm" onClick={() => setJeLines((ls) => [...ls, blankJeLine()])}>+ Add line</Button>
                  </div>
                  {jeLines.map((l, i) => (
                    <div key={i} className="grid grid-cols-12 gap-2 items-end">
                      <div className="col-span-4">
                        <Label className="sr-only" htmlFor={`rt-je-account-${i}`}>Account</Label>
                        <select
                          id={`rt-je-account-${i}`}
                          className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                          value={l.account_id}
                          onChange={(e) => updateJeLine(i, { account_id: e.target.value })}
                          required
                        >
                          <option value="">Select account…</option>
                          {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                        </select>
                      </div>
                      <div className="col-span-2">
                        <Label className="sr-only" htmlFor={`rt-je-debit-${i}`}>Debit</Label>
                        <Input id={`rt-je-debit-${i}`} type="number" step="0.0001" min="0" value={l.debit} onChange={(e) => updateJeLine(i, { debit: e.target.value, credit: '0.00' })} />
                      </div>
                      <div className="col-span-2">
                        <Label className="sr-only" htmlFor={`rt-je-credit-${i}`}>Credit</Label>
                        <Input id={`rt-je-credit-${i}`} type="number" step="0.0001" min="0" value={l.credit} onChange={(e) => updateJeLine(i, { credit: e.target.value, debit: '0.00' })} />
                      </div>
                      <div className="col-span-3">
                        <Label className="sr-only" htmlFor={`rt-je-memo-${i}`}>Memo</Label>
                        <Input id={`rt-je-memo-${i}`} value={l.memo} onChange={(e) => updateJeLine(i, { memo: e.target.value })} placeholder="Line memo" />
                      </div>
                      <div className="col-span-1">
                        <Button type="button" variant="ghost" onClick={() => setJeLines((ls) => ls.filter((_, idx) => idx !== i))} disabled={jeLines.length <= 2}>×</Button>
                      </div>
                    </div>
                  ))}
                  <div className="flex justify-end gap-8 pt-3 border-t font-mono text-sm">
                    <div>Total Debit: {fmtMoney(totalD)}</div>
                    <div>Total Credit: {fmtMoney(totalC)}</div>
                    <div className={balanced ? 'text-green-600' : 'text-destructive'}>{balanced ? 'BALANCED' : 'UNBALANCED'}</div>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Lines</Label>
                    <Button type="button" variant="outline" size="sm" onClick={() => setDocLines((ls) => [...ls, blankDocLine()])}>+ Add line</Button>
                  </div>
                  {docLines.map((l, i) => (
                    <div key={i} className="grid grid-cols-12 gap-2 items-end">
                      <div className="col-span-4">
                        <Label className="sr-only" htmlFor={`rt-doc-desc-${i}`}>Description</Label>
                        <Input id={`rt-doc-desc-${i}`} value={l.description} onChange={(e) => updateDocLine(i, { description: e.target.value })} placeholder="Description" />
                      </div>
                      <div className="col-span-2">
                        <Label className="sr-only" htmlFor={`rt-doc-qty-${i}`}>Qty</Label>
                        <Input id={`rt-doc-qty-${i}`} type="number" step="0.0001" min="0" value={l.quantity} onChange={(e) => updateDocLine(i, { quantity: e.target.value })} placeholder="Qty" />
                      </div>
                      <div className="col-span-2">
                        <Label className="sr-only" htmlFor={`rt-doc-rate-${i}`}>Rate</Label>
                        <Input id={`rt-doc-rate-${i}`} type="number" step="0.0001" min="0" value={l.unit_price} onChange={(e) => updateDocLine(i, { unit_price: e.target.value })} placeholder="Rate" />
                      </div>
                      <div className="col-span-3">
                        <Label className="sr-only" htmlFor={`rt-doc-account-${i}`}>{form.template_type === 'invoice' ? 'Income account' : 'Expense account'}</Label>
                        <select
                          id={`rt-doc-account-${i}`}
                          className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                          value={l.account_id}
                          onChange={(e) => updateDocLine(i, { account_id: e.target.value })}
                          required
                        >
                          <option value="">{form.template_type === 'invoice' ? 'Income account…' : 'Expense account…'}</option>
                          {(form.template_type === 'invoice' ? revenueAccounts : expenseAccounts).map((a) => (
                            <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                          ))}
                        </select>
                      </div>
                      <div className="col-span-1">
                        <Button type="button" variant="ghost" onClick={() => setDocLines((ls) => ls.filter((_, idx) => idx !== i))} disabled={docLines.length <= 1}>×</Button>
                      </div>
                    </div>
                  ))}
                  <div className="flex justify-end pt-3 border-t font-mono text-sm">
                    <div>Total: {fmtMoney(docTotal)}</div>
                  </div>
                </div>
              )}

              {formErr && <p className="text-sm text-destructive">{formErr}</p>}
              <div className="flex gap-2">
                <Button type="submit" disabled={busy || (isJe && !balanced)}>{busy ? 'Saving…' : 'Create template'}</Button>
                <Button type="button" variant="outline" onClick={() => { setShowForm(false); resetForm(); }}>Cancel</Button>
              </div>
            </form>
          )}

          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40">
              <tr>
                <th className="text-left p-3 font-medium text-xs uppercase tracking-wide">Template Name</th>
                <th className="text-left p-3 font-medium text-xs uppercase tracking-wide">Status</th>
                <th className="text-left p-3 font-medium text-xs uppercase tracking-wide">TXN Type</th>
                <th className="text-left p-3 font-medium text-xs uppercase tracking-wide">Interval</th>
                <th className="text-left p-3 font-medium text-xs uppercase tracking-wide">Previous Date</th>
                <th className="text-left p-3 font-medium text-xs uppercase tracking-wide">Next Date</th>
                <th className="text-left p-3 font-medium text-xs uppercase tracking-wide">Customer/Vendor</th>
                <th className="text-right p-3 font-medium text-xs uppercase tracking-wide">Amount</th>
                <th className="text-right p-3 font-medium text-xs uppercase tracking-wide">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredTemplates.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-4 text-center text-muted-foreground">
                    {templates.length === 0 ? 'No templates yet.' : 'No templates match the filter.'}
                  </td>
                </tr>
              ) : (
                filteredTemplates.map((t) => {
                  const upcoming = nextDates(t);
                  const runs = runsCache[t.id];
                  return (
                    <FragmentRow
                      key={t.id}
                      t={t}
                      upcoming={upcoming}
                      expanded={expandedId === t.id}
                      runs={runs}
                      party={templateParty(t, customers, vendors)}
                      onTogglePaused={() => togglePaused(t)}
                      onToggleHistory={() => toggleHistory(t)}
                      onDelete={() => deleteTemplate(t.id)}
                    />
                  );
                })
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Filter modal */}
      {showFilterModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-background rounded-lg shadow-xl w-full max-w-sm mx-4">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <h2 className="text-lg font-semibold">Recurring Transactions</h2>
              <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setShowFilterModal(false)}>✕</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <Label htmlFor="rt-filter-interval">Template Type</Label>
                <select
                  id="rt-filter-interval"
                  className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={pendingTemplateType}
                  onChange={e => setPendingTemplateType(e.target.value)}
                >
                  <option value="">All</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </div>
              <div>
                <Label htmlFor="rt-filter-txn">Transaction Type</Label>
                <select
                  id="rt-filter-txn"
                  className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={pendingTxnType}
                  onChange={e => setPendingTxnType(e.target.value)}
                >
                  <option value="">All</option>
                  {TXN_TYPE_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="border-t px-6 py-4 flex items-center justify-between gap-2">
              <Button variant="outline" onClick={() => { setPendingTemplateType(''); setPendingTxnType(''); }}>Reset</Button>
              <Button onClick={applyFilter}>Apply</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FragmentRow(props: {
  t: Template;
  upcoming: string[];
  expanded: boolean;
  runs: TemplateRun[] | 'loading' | undefined;
  party: string;
  onTogglePaused: () => void;
  onToggleHistory: () => void;
  onDelete: () => void;
}) {
  const { t, upcoming, expanded, runs, party } = props;
  return (
    <>
      <tr className="border-b last:border-b-0 hover:bg-muted/20">
        <td className="p-3">{t.name}</td>
        <td className="p-3">
          <span className={t.is_active ? 'text-emerald-600' : 'text-muted-foreground'}>
            {t.is_active ? 'Scheduled' : 'Paused'}
          </span>
        </td>
        <td className="p-3">{TXN_TYPE_LABELS[t.template_type] ?? t.template_type}</td>
        <td className="p-3">{INTERVAL_LABELS[t.recurrence] ?? t.recurrence}</td>
        <td className="p-3 font-mono">{fmtDate(t.last_run_at)}</td>
        <td className="p-3 font-mono" title={upcoming.length > 0 ? `Upcoming: ${upcoming.join(', ')}` : undefined}>
          {fmtDate(t.next_run_date)}
        </td>
        <td className="p-3 text-muted-foreground">{party}</td>
        <td className="p-3 text-right font-mono">{fmtMoney(templateAmount(t))}</td>
        <td className="p-3 text-right whitespace-nowrap">
          <Button size="sm" variant="ghost" className="text-primary hover:text-primary h-auto p-0 font-normal" onClick={props.onTogglePaused}>
            {t.is_active ? 'Pause' : 'Resume'}
          </Button>
          <span className="text-muted-foreground/40 px-1.5">|</span>
          <Button size="sm" variant="ghost" className="text-primary hover:text-primary h-auto p-0 font-normal" onClick={props.onToggleHistory}>
            History
          </Button>
          <span className="text-muted-foreground/40 px-1.5">|</span>
          <Button size="sm" variant="ghost" className="text-primary hover:text-primary h-auto p-0 font-normal" onClick={props.onDelete}>
            Delete
          </Button>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b bg-muted/10">
          <td colSpan={9} className="px-6 py-3">
            {runs === 'loading' || runs === undefined ? (
              <p className="text-sm text-muted-foreground">Loading run history…</p>
            ) : runs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No runs yet. Upcoming: {upcoming.map(d => fmtDate(d)).join(', ') || '—'}</p>
            ) : (
              <div className="space-y-1 text-sm">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Run history</p>
                <ul className="divide-y">
                  {runs.map((r, i) => (
                    <li key={i} className="flex items-center justify-between py-1.5">
                      <span className="font-mono">{fmtDate(r.at)}</span>
                      <span>{r.runs_created} {r.runs_created === 1 ? 'entry' : 'entries'} created</span>
                      <span className="text-muted-foreground">advanced to <span className="font-mono">{fmtDate(r.advanced_to)}</span></span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
