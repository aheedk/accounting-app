import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, CheckCircle, XCircle } from 'lucide-react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { fmtMoney } from '@/lib/money';

type LineItem = {
  description: string;
  quantity: string;
  unit_price: string;
  amount: string;
  suggested_account?: string;
};

type InvoiceImport = {
  id: string;
  email_from: string | null;
  email_subject: string | null;
  received_at: string;
  invoice_type: 'ap' | 'ar';
  vendor_customer: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  line_items: LineItem[];
  subtotal: string | null;
  tax_amount: string | null;
  total: string | null;
  status: string;
};

type CoaAccount = { id: string; code: string; name: string; account_type: string };

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function InvoiceImportReviewPage() {
  const [bizId] = useActiveBusinessId();
  const nav = useNavigate();

  const [tab, setTab] = useState<'all' | 'ap' | 'ar'>('all');
  const [imports, setImports] = useState<InvoiceImport[]>([]);
  const [accounts, setAccounts] = useState<CoaAccount[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedImport, setSelectedImport] = useState<InvoiceImport | null>(null);
  const [lineAccountIds, setLineAccountIds] = useState<Record<number, string>>({});
  const [lineIncluded, setLineIncluded] = useState<Record<number, boolean>>({});
  const [apAccountId, setApAccountId] = useState('');
  const [arAccountId, setArAccountId] = useState('');
  const [taxAccountId, setTaxAccountId] = useState('');
  const [includeTax, setIncludeTax] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!bizId) return;
    setLoading(true);
    Promise.all([
      api.get(`/businesses/${bizId}/invoice-imports`),
      api.get(`/businesses/${bizId}/coa`),
    ]).then(([importsRes, coaRes]) => {
      setImports((importsRes.data.imports as InvoiceImport[]) ?? []);
      setAccounts((coaRes.data.accounts as CoaAccount[]) ?? []);
    }).catch((e: unknown) => { console.error('invoice-imports load failed', e); }).finally(() => setLoading(false));
  }, [bizId]);

  function openImport(imp: InvoiceImport) {
    setSelectedImport(imp);
    setError(null);
    setApAccountId('');
    setArAccountId('');
    setTaxAccountId('');
    setIncludeTax(false);

    const initIncluded: Record<number, boolean> = {};
    const initAccounts: Record<number, string> = {};
    imp.line_items.forEach((li, i) => {
      initIncluded[i] = true;
      if (li.suggested_account) {
        const hint = li.suggested_account.toLowerCase();
        const match = accounts.find(a =>
          a.name.toLowerCase().includes(hint) || hint.includes(a.name.toLowerCase()),
        );
        if (match) initAccounts[i] = match.id;
      }
    });
    setLineIncluded(initIncluded);
    setLineAccountIds(initAccounts);
  }

  async function handleApprove() {
    if (!bizId || !selectedImport) return;
    const isAp = selectedImport.invoice_type === 'ap';

    if (isAp && !apAccountId) { setError('Select an Accounts Payable account.'); return; }
    if (!isAp && !arAccountId) { setError('Select an Accounts Receivable account.'); return; }

    const missing = selectedImport.line_items.findIndex((_, i) => lineIncluded[i] && !lineAccountIds[i]);
    if (missing !== -1) { setError(`Select an account for line item ${missing + 1}.`); return; }

    setPosting(true);
    setError(null);
    try {
      await api.post(`/businesses/${bizId}/invoice-imports/${selectedImport.id}/approve`, {
        ap_account_id: isAp ? apAccountId : undefined,
        ar_account_id: !isAp ? arAccountId : undefined,
        tax_account_id: includeTax ? taxAccountId : undefined,
        include_tax: includeTax,
        line_items: selectedImport.line_items.map((_, i) => ({
          index: i,
          account_id: lineAccountIds[i] ?? '',
          include: lineIncluded[i] ?? true,
        })),
      });
      setImports(prev => prev.filter(im => im.id !== selectedImport.id));
      setSelectedImport(null);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to post journal entry';
      setError(msg);
    } finally {
      setPosting(false);
    }
  }

  async function handleReject(imp: InvoiceImport) {
    if (!bizId) return;
    await api.post(`/businesses/${bizId}/invoice-imports/${imp.id}/reject`, {});
    setImports(prev => prev.filter(im => im.id !== imp.id));
    if (selectedImport?.id === imp.id) setSelectedImport(null);
  }

  const filtered = tab === 'all' ? imports : imports.filter(im => im.invoice_type === tab);
  const liabilityAccounts = accounts.filter(a => a.account_type === 'liability');
  const assetAccounts = accounts.filter(a => a.account_type === 'asset');

  if (!bizId) return <div className="p-6">Select a business first.</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => nav(-1)} className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
          <ChevronLeft className="h-4 w-4" />Back
        </button>
        <div>
          <h1 className="text-xl font-semibold">Invoice Import Review</h1>
          <p className="text-sm text-muted-foreground">Review AI-extracted invoice data before posting to the ledger.</p>
        </div>
      </div>

      {/* Tabs */}
      {!selectedImport && (
        <div className="flex gap-1 rounded-lg border bg-muted/20 p-1 w-fit">
          {(['all', 'ap', 'ar'] as const).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === t ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {t === 'all' ? 'All' : t === 'ap' ? 'AP (Bills)' : 'AR (Invoices)'}
              <span className="ml-1.5 text-xs text-muted-foreground">
                ({t === 'all' ? imports.length : imports.filter(im => im.invoice_type === t).length})
              </span>
            </button>
          ))}
        </div>
      )}

      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {!loading && filtered.length === 0 && !selectedImport && (
        <div className="rounded-lg border bg-muted/20 p-12 text-center">
          <CheckCircle className="h-10 w-10 text-emerald-500 mx-auto mb-3" />
          <p className="font-medium">No pending {tab === 'all' ? '' : tab.toUpperCase() + ' '}imports</p>
          <p className="text-sm text-muted-foreground mt-1">Invoice emails labeled "invoices" will appear here automatically.</p>
        </div>
      )}

      {/* Import list */}
      {!selectedImport && filtered.length > 0 && (
        <div className="rounded-lg border divide-y">
          {filtered.map(imp => (
            <div key={imp.id} className="flex items-center justify-between px-4 py-3 hover:bg-muted/20">
              <div className="min-w-0 flex items-center gap-3">
                <span className={`shrink-0 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${imp.invoice_type === 'ap' ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                  {imp.invoice_type.toUpperCase()}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{imp.vendor_customer ?? imp.email_subject ?? '(unknown)'}</p>
                  <p className="text-xs text-muted-foreground">
                    #{imp.invoice_number ?? '—'} · {imp.invoice_date ?? '—'} · {imp.total ? fmtMoney(imp.total) : '—'} · {imp.line_items.length} lines
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-4">
                <button type="button" onClick={() => openImport(imp)}
                  className="inline-flex h-8 items-center rounded-md bg-primary text-primary-foreground px-3 text-sm font-medium hover:bg-primary/90">
                  Review
                </button>
                <button type="button" onClick={() => handleReject(imp)}
                  className="inline-flex h-8 items-center rounded-md border px-3 text-sm text-destructive hover:bg-destructive/10">
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Review panel */}
      {selectedImport && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${selectedImport.invoice_type === 'ap' ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                {selectedImport.invoice_type === 'ap' ? 'AP — Bill from Vendor' : 'AR — Invoice to Customer'}
              </span>
              <div>
                <p className="font-medium">{selectedImport.vendor_customer ?? '(unknown)'} — Invoice #{selectedImport.invoice_number ?? '—'}</p>
                <p className="text-xs text-muted-foreground">Date: {selectedImport.invoice_date ?? '—'} · Due: {selectedImport.due_date ?? '—'} · Received {fmtDate(selectedImport.received_at)}</p>
              </div>
            </div>
            <button type="button" onClick={() => setSelectedImport(null)} className="text-sm text-muted-foreground hover:underline">← Back</button>
          </div>

          {/* Control account selector */}
          <div className="rounded-lg border p-4 bg-muted/10 space-y-3">
            {selectedImport.invoice_type === 'ap' ? (
              <div className="flex items-center gap-3">
                <label className="text-sm font-medium whitespace-nowrap w-48">Accounts Payable account</label>
                <select value={apAccountId} onChange={e => setApAccountId(e.target.value)}
                  className="flex-1 rounded-md border bg-background px-3 py-1.5 text-sm">
                  <option value="">— select —</option>
                  {liabilityAccounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                </select>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <label className="text-sm font-medium whitespace-nowrap w-48">Accounts Receivable account</label>
                <select value={arAccountId} onChange={e => setArAccountId(e.target.value)}
                  className="flex-1 rounded-md border bg-background px-3 py-1.5 text-sm">
                  <option value="">— select —</option>
                  {assetAccounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                </select>
              </div>
            )}

            {/* Tax line */}
            <div className="flex items-center gap-3">
              <label className="text-sm font-medium whitespace-nowrap w-48 flex items-center gap-2">
                <input type="checkbox" checked={includeTax} onChange={e => setIncludeTax(e.target.checked)} />
                Include tax ({selectedImport.tax_amount ? fmtMoney(selectedImport.tax_amount) : '0.00'})
              </label>
              {includeTax && (
                <select value={taxAccountId} onChange={e => setTaxAccountId(e.target.value)}
                  className="flex-1 rounded-md border bg-background px-3 py-1.5 text-sm">
                  <option value="">— tax account —</option>
                  {accounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                </select>
              )}
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          {/* Line items table */}
          <div className="rounded-lg border overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="px-3 py-2 text-left w-8">
                    <input type="checkbox" checked={Object.values(lineIncluded).every(Boolean)}
                      onChange={e => { const v = e.target.checked; setLineIncluded(prev => Object.fromEntries(Object.keys(prev).map(k => [k, v]))); }} />
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase">Description</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground uppercase">Qty</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground uppercase">Unit Price</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground uppercase">Amount</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase min-w-[200px]">
                    {selectedImport.invoice_type === 'ap' ? 'Expense account' : 'Revenue account'}
                  </th>
                </tr>
              </thead>
              <tbody>
                {selectedImport.line_items.map((li, i) => (
                  <tr key={i} className={`border-b ${!lineIncluded[i] ? 'opacity-40' : ''}`}>
                    <td className="px-3 py-2">
                      <input type="checkbox" checked={lineIncluded[i] ?? true}
                        onChange={e => setLineIncluded(prev => ({ ...prev, [i]: e.target.checked }))} />
                    </td>
                    <td className="px-3 py-2 max-w-[220px] truncate">{li.description}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs">{li.quantity}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs">{fmtMoney(li.unit_price)}</td>
                    <td className="px-3 py-2 text-right font-mono font-medium">{fmtMoney(li.amount)}</td>
                    <td className="px-3 py-2">
                      <select
                        disabled={!lineIncluded[i]}
                        value={lineAccountIds[i] ?? ''}
                        onChange={e => setLineAccountIds(prev => ({ ...prev, [i]: e.target.value }))}
                        title={li.suggested_account ? `AI suggested: ${li.suggested_account}` : undefined}
                        className={`w-full rounded border bg-background px-2 py-1 text-xs disabled:opacity-40 ${lineAccountIds[i] ? 'border-emerald-400' : ''}`}
                      >
                        <option value="">— select account —</option>
                        {accounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-muted/20 font-medium">
                  <td colSpan={4} className="px-3 py-2 text-right text-sm">Subtotal</td>
                  <td className="px-3 py-2 text-right font-mono">{selectedImport.subtotal ? fmtMoney(selectedImport.subtotal) : '—'}</td>
                  <td />
                </tr>
                {selectedImport.tax_amount && parseFloat(selectedImport.tax_amount) > 0 && (
                  <tr className="bg-muted/10">
                    <td colSpan={4} className="px-3 py-2 text-right text-sm text-muted-foreground">Tax</td>
                    <td className="px-3 py-2 text-right font-mono text-muted-foreground">{fmtMoney(selectedImport.tax_amount)}</td>
                    <td />
                  </tr>
                )}
                <tr className="bg-muted/30 font-semibold border-t-2">
                  <td colSpan={4} className="px-3 py-2 text-right">Total</td>
                  <td className="px-3 py-2 text-right font-mono">{selectedImport.total ? fmtMoney(selectedImport.total) : '—'}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="flex items-center justify-between pt-2">
            <button type="button" onClick={() => handleReject(selectedImport)}
              className="inline-flex items-center gap-1.5 h-9 rounded-md border px-4 text-sm text-destructive hover:bg-destructive/10">
              <XCircle className="h-4 w-4" />Reject
            </button>
            <button type="button" onClick={handleApprove} disabled={posting}
              className="inline-flex items-center gap-1.5 h-9 rounded-md bg-emerald-600 text-white px-5 text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50">
              <CheckCircle className="h-4 w-4" />
              {posting ? 'Posting…' : `Post Journal Entry`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
