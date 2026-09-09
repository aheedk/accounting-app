import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, CheckCircle, XCircle, FileText, CreditCard, RefreshCw, History, ExternalLink } from 'lucide-react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { fmtMoney } from '@/lib/money';

// ── Bank statement types ──────────────────────────────────────────────────────
type ExtractedTx = {
  date: string;
  description: string;
  amount: string;
  type: 'debit' | 'credit';
  balance: string;
  suggested_offset?: string;
  suggested_account_id?: string;
};

type StagedImport = {
  id: string;
  email_from: string | null;
  email_subject: string | null;
  received_at: string;
  extracted_transactions: ExtractedTx[];
  status: string;
};

// ── Invoice types ─────────────────────────────────────────────────────────────
type LineItem = {
  description: string;
  quantity: string;
  unit_price: string;
  amount: string;
  suggested_account?: string;
  suggested_account_id?: string;
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
type Vendor = { id: string; name: string };
type Customer = { id: string; name: string };

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function deriveBankTitle(imp: StagedImport): string {
  const txs = imp.extracted_transactions;
  if (txs.length === 0) return imp.email_subject ?? 'Bank Statement';
  const dates = txs.flatMap(tx => {
    const [m, d, y] = tx.date.split('/');
    if (!m || !d || !y) return [];
    const dt = new Date(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`);
    return isNaN(dt.getTime()) ? [] : [dt];
  });
  if (dates.length === 0) return imp.email_subject ?? 'Bank Statement';
  const minD = new Date(Math.min(...dates.map(d => d.getTime())));
  const maxD = new Date(Math.max(...dates.map(d => d.getTime())));
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  return fmt(minD) === fmt(maxD) ? `${fmt(minD)} Statement` : `${fmt(minD)} – ${fmt(maxD)} Statement`;
}

function deriveBankSubtitle(imp: StagedImport): string {
  const txs = imp.extracted_transactions as ExtractedTx[];
  const deposits = txs.filter(tx => tx.type === 'credit').length;
  const payments = txs.filter(tx => tx.type === 'debit').length;
  return `${txs.length} transactions · ${deposits} deposits · ${payments} payments`;
}

type TopTab = 'bank' | 'invoice' | 'history';

export default function EmailImportReviewPage() {
  const [bizId] = useActiveBusinessId();
  const nav = useNavigate();
  const [topTab, setTopTab] = useState<TopTab>('bank');
  const [accounts, setAccounts] = useState<CoaAccount[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pdfLoading, setPdfLoading] = useState<string | null>(null);

  // History state
  const [historyBank, setHistoryBank] = useState<StagedImport[]>([]);
  const [historyInvoices, setHistoryInvoices] = useState<InvoiceImport[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Bank state
  const [bankImports, setBankImports] = useState<StagedImport[]>([]);
  const [selectedBank, setSelectedBank] = useState<StagedImport | null>(null);
  const [bankAccountId, setBankAccountId] = useState('');
  const [offsets, setOffsets] = useState<Record<number, string>>({});
  const [included, setIncluded] = useState<Record<number, boolean>>({});
  const [bankPosting, setBankPosting] = useState(false);
  const [bankError, setBankError] = useState<string | null>(null);

  // Invoice state
  const [invoiceImports, setInvoiceImports] = useState<InvoiceImport[]>([]);
  const [invoiceTab, setInvoiceTab] = useState<'all' | 'ap' | 'ar'>('all');
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceImport | null>(null);
  const [lineAccountIds, setLineAccountIds] = useState<Record<number, string>>({});
  const [lineIncluded, setLineIncluded] = useState<Record<number, boolean>>({});
  const [selectedVendorId, setSelectedVendorId] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [taxAccountId, setTaxAccountId] = useState('');
  const [includeTax, setIncludeTax] = useState(false);
  const [invPosting, setInvPosting] = useState(false);
  const [invError, setInvError] = useState<string | null>(null);

  const loadPending = useCallback(() => {
    if (!bizId) return;
    setLoading(true);
    Promise.all([
      api.get(`/businesses/${bizId}/email-imports`),
      api.get(`/businesses/${bizId}/invoice-imports`),
      api.get(`/businesses/${bizId}/coa`),
      api.get(`/businesses/${bizId}/vendors`),
      api.get(`/businesses/${bizId}/customers`),
    ]).then(([bankRes, invRes, coaRes, vendRes, custRes]) => {
      setBankImports((bankRes.data.imports as StagedImport[]) ?? []);
      setInvoiceImports((invRes.data.imports as InvoiceImport[]) ?? []);
      setAccounts((coaRes.data.accounts as CoaAccount[]) ?? []);
      setVendors((vendRes.data.vendors as Vendor[]) ?? []);
      setCustomers((custRes.data.customers as Customer[]) ?? []);
    }).catch((e: unknown) => { console.error('email-imports load failed', e); }).finally(() => setLoading(false));
  }, [bizId]);

  useEffect(() => { loadPending(); }, [loadPending]);

  const loadHistory = useCallback(() => {
    if (!bizId) return;
    setHistoryLoading(true);
    Promise.all([
      api.get(`/businesses/${bizId}/email-imports?history=1`),
      api.get(`/businesses/${bizId}/invoice-imports?history=1`),
    ]).then(([bankRes, invRes]) => {
      setHistoryBank((bankRes.data.imports as StagedImport[]) ?? []);
      setHistoryInvoices((invRes.data.imports as InvoiceImport[]) ?? []);
    }).catch((e: unknown) => { console.error('history load failed', e); }).finally(() => setHistoryLoading(false));
  }, [bizId]);

  useEffect(() => { if (topTab === 'history') loadHistory(); }, [topTab, loadHistory]);

  async function openPdf(type: 'bank' | 'invoice', id: string) {
    if (pdfLoading) return;
    setPdfLoading(id);
    try {
      const url = type === 'bank'
        ? `/businesses/${bizId}/email-imports/${id}/pdf`
        : `/businesses/${bizId}/invoice-imports/${id}/pdf`;
      const res = await api.get(url, { responseType: 'blob' });
      const blob = new Blob([res.data as BlobPart], { type: 'application/pdf' });
      const blobUrl = URL.createObjectURL(blob);
      window.open(blobUrl, '_blank');
    } catch {
      alert('PDF not available for this record. Only emails received after the latest update have a stored PDF.');
    } finally {
      setPdfLoading(null);
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await Promise.all([
        api.post('/email-imports/poll', {}),
        new Promise(res => setTimeout(res, 2000)),
      ]);
      loadPending();
    } catch (e: unknown) { console.error('poll failed', e); }
    finally { setRefreshing(false); }
  }

  // ── Bank helpers ─────────────────────────────────────────────────────────────
  function openBank(imp: StagedImport) {
    setSelectedBank(imp);
    setBankAccountId('');
    setBankError(null);
    const initIncluded: Record<number, boolean> = {};
    const initOffsets: Record<number, string> = {};
    imp.extracted_transactions.forEach((tx, i) => {
      initIncluded[i] = true;
      if (tx.suggested_account_id) {
        initOffsets[i] = tx.suggested_account_id;
      } else if (tx.suggested_offset) {
        const hint = tx.suggested_offset.toLowerCase();
        const match = accounts.find(a =>
          a.name.toLowerCase().includes(hint) || hint.includes(a.name.toLowerCase()),
        );
        if (match) initOffsets[i] = match.id;
      }
    });
    setIncluded(initIncluded);
    setOffsets(initOffsets);
  }

  async function handleBankApprove() {
    if (!bizId || !selectedBank) return;
    if (!bankAccountId) { setBankError('Select a bank account first.'); return; }
    const missing = selectedBank.extracted_transactions.findIndex((_, i) => included[i] && !offsets[i]);
    if (missing !== -1) { setBankError(`Select an offset account for row ${missing + 1}.`); return; }
    setBankPosting(true);
    setBankError(null);
    try {
      await api.post(`/businesses/${bizId}/email-imports/${selectedBank.id}/approve`, {
        bank_account_id: bankAccountId,
        transactions: selectedBank.extracted_transactions.map((_, i) => ({
          index: i,
          offset_account_id: offsets[i] ?? '',
          include: included[i] ?? true,
        })),
      });
      setBankImports(prev => prev.filter(im => im.id !== selectedBank.id));
      setSelectedBank(null);
    } catch (e: unknown) {
      setBankError(e instanceof Error ? e.message : 'Failed to post journal entries');
    } finally { setBankPosting(false); }
  }

  async function handleBankReject(imp: StagedImport) {
    if (!bizId) return;
    await api.post(`/businesses/${bizId}/email-imports/${imp.id}/reject`, {});
    setBankImports(prev => prev.filter(im => im.id !== imp.id));
    if (selectedBank?.id === imp.id) setSelectedBank(null);
  }

  // ── Invoice helpers ───────────────────────────────────────────────────────────
  function openInvoice(imp: InvoiceImport) {
    setSelectedInvoice(imp);
    setInvError(null);
    setSelectedVendorId('');
    setSelectedCustomerId('');
    setTaxAccountId('');
    setIncludeTax(!!imp.tax_amount && parseFloat(imp.tax_amount) > 0);
    const initIncluded: Record<number, boolean> = {};
    const initAccounts: Record<number, string> = {};
    imp.line_items.forEach((li, i) => {
      initIncluded[i] = true;
      if (li.suggested_account_id) {
        initAccounts[i] = li.suggested_account_id;
      } else if (li.suggested_account) {
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

  async function handleInvoiceApprove() {
    if (!bizId || !selectedInvoice) return;
    const isAp = selectedInvoice.invoice_type === 'ap';
    if (isAp && !selectedVendorId) { setInvError('Select a vendor to create the bill.'); return; }
    if (!isAp && !selectedCustomerId) { setInvError('Select a customer to create the invoice.'); return; }
    if (includeTax && !taxAccountId) { setInvError('Select an account for the tax line.'); return; }
    const missing = selectedInvoice.line_items.findIndex((_, i) => lineIncluded[i] && !lineAccountIds[i]);
    if (missing !== -1) { setInvError(`Select an account for line item ${missing + 1}.`); return; }
    setInvPosting(true);
    setInvError(null);
    try {
      await api.post(`/businesses/${bizId}/invoice-imports/${selectedInvoice.id}/approve`, {
        ...(isAp ? { vendor_id: selectedVendorId } : { customer_id: selectedCustomerId }),
        include_tax: includeTax,
        ...(includeTax && taxAccountId ? { tax_account_id: taxAccountId } : {}),
        line_items: selectedInvoice.line_items.map((_, i) => ({
          index: i,
          account_id: lineAccountIds[i] ?? '',
          include: lineIncluded[i] ?? true,
        })),
      });
      setInvoiceImports(prev => prev.filter(im => im.id !== selectedInvoice.id));
      setSelectedInvoice(null);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setInvError(msg ?? (e instanceof Error ? e.message : 'Failed to post'));
    } finally { setInvPosting(false); }
  }

  async function handleInvoiceReject(imp: InvoiceImport) {
    if (!bizId) return;
    await api.post(`/businesses/${bizId}/invoice-imports/${imp.id}/reject`, {});
    setInvoiceImports(prev => prev.filter(im => im.id !== imp.id));
    if (selectedInvoice?.id === imp.id) setSelectedInvoice(null);
  }

  const bankAccounts = accounts.filter(a => a.account_type === 'asset');
  const filteredInvoices = invoiceTab === 'all' ? invoiceImports : invoiceImports.filter(im => im.invoice_type === invoiceTab);
  const totalPending = bankImports.length + invoiceImports.length;

  if (!bizId) return <div className="p-6">Select a business first.</div>;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => nav(-1)} className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
          <ChevronLeft className="h-4 w-4" />Back
        </button>
        <div>
          <h1 className="text-xl font-semibold">Email Import Review</h1>
          <p className="text-sm text-muted-foreground">
            AI-extracted documents pending accountant review before posting to the ledger.
            {totalPending > 0 && <span className="ml-2 inline-flex items-center rounded-full bg-amber-100 text-amber-800 px-2 py-0.5 text-xs font-medium">{totalPending} pending</span>}
          </p>
        </div>
      </div>

      {/* Top tabs + refresh */}
      {!selectedBank && !selectedInvoice && (
        <div className="flex items-center justify-between">
          <div className="flex gap-0 rounded-xl border overflow-hidden w-fit">
            <button type="button" onClick={() => setTopTab('bank')}
              className={`relative flex items-center gap-2 px-5 py-2.5 text-sm font-medium transition-colors border-r ${topTab === 'bank' ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-muted/30'}`}>
              <CreditCard className="h-4 w-4" />
              Bank Statements
              {topTab === 'bank' && bankImports.length > 0 && (
                <span className="inline-flex rounded-full bg-white/20 text-white px-1.5 py-0.5 text-[10px] font-semibold">{bankImports.length}</span>
              )}
              {topTab !== 'bank' && bankImports.length > 0 && (
                <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-600 text-white px-1 text-[9px] font-bold leading-none">
                  {bankImports.length}
                </span>
              )}
            </button>
            <button type="button" onClick={() => setTopTab('invoice')}
              className={`relative flex items-center gap-2 px-5 py-2.5 text-sm font-medium transition-colors border-r ${topTab === 'invoice' ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-muted/30'}`}>
              <FileText className="h-4 w-4" />
              Invoices
              {topTab === 'invoice' && invoiceImports.length > 0 && (
                <span className="inline-flex rounded-full bg-white/20 text-white px-1.5 py-0.5 text-[10px] font-semibold">{invoiceImports.length}</span>
              )}
              {topTab !== 'invoice' && invoiceImports.length > 0 && (
                <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-600 text-white px-1 text-[9px] font-bold leading-none">
                  {invoiceImports.length}
                </span>
              )}
            </button>
            <button type="button" onClick={() => setTopTab('history')}
              className={`flex items-center gap-2 px-5 py-2.5 text-sm font-medium transition-colors ${topTab === 'history' ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-muted/30'}`}>
              <History className="h-4 w-4" />
              History
            </button>
          </div>
          <button type="button" onClick={handleRefresh} disabled={refreshing}
            className="inline-flex items-center gap-2 h-9 rounded-md border px-4 text-sm font-medium transition-colors hover:bg-primary/5 hover:border-primary hover:text-primary disabled:opacity-50 disabled:cursor-not-allowed">
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Checking Gmail…' : 'Refresh'}
          </button>
        </div>
      )}

      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {/* ── BANK STATEMENTS TAB ─────────────────────────────────────────────── */}
      {!loading && topTab === 'bank' && (
        <>
          {bankImports.length === 0 && !selectedBank && (
            <div className="rounded-lg border bg-muted/20 p-12 text-center">
              <CreditCard className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="font-medium">No pending bank statements</p>
              <p className="text-sm text-muted-foreground mt-1">Email PDFs to the firm inbox and label them <code className="text-xs bg-muted px-1 py-0.5 rounded">bank-statements</code>.</p>
            </div>
          )}

          {!selectedBank && bankImports.length > 0 && (
            <div className="rounded-lg border divide-y">
              {bankImports.map(imp => (
                <div key={imp.id} className="flex items-center justify-between px-4 py-3 hover:bg-muted/20">
                  <div className="min-w-0 flex items-center gap-3">
                    <div className="shrink-0 h-9 w-9 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center">
                      <CreditCard className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate">{deriveBankTitle(imp)}</p>
                      <p className="text-xs text-muted-foreground">{deriveBankSubtitle(imp)} · received {fmtDate(imp.received_at)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-4">
                    <button type="button" onClick={() => openPdf('bank', imp.id)}
                      disabled={pdfLoading === imp.id}
                      className="inline-flex h-8 items-center rounded-md border px-3 text-sm gap-1.5 transition-colors hover:bg-primary/5 hover:border-primary hover:text-primary disabled:opacity-50 disabled:cursor-not-allowed"
                      title="View original PDF">
                      {pdfLoading === imp.id
                        ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        : <ExternalLink className="h-3.5 w-3.5" />}
                      PDF
                    </button>
                    <button type="button" onClick={() => openBank(imp)}
                      className="inline-flex h-8 items-center rounded-md bg-primary text-primary-foreground px-3 text-sm font-medium hover:bg-primary/90">
                      Review
                    </button>
                    <button type="button" onClick={() => handleBankReject(imp)}
                      className="inline-flex h-8 items-center rounded-md border px-3 text-sm text-destructive hover:bg-destructive/10">
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {selectedBank && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold">{deriveBankTitle(selectedBank)}</p>
                  <p className="text-xs text-muted-foreground">{deriveBankSubtitle(selectedBank)} · received {fmtDate(selectedBank.received_at)}</p>
                </div>
                <div className="flex items-center gap-3">
                  <button type="button" onClick={() => openPdf('bank', selectedBank.id)}
                    disabled={pdfLoading === selectedBank.id}
                    className="inline-flex h-8 items-center rounded-md border px-3 text-sm gap-1.5 transition-colors hover:bg-primary/5 hover:border-primary hover:text-primary disabled:opacity-50 disabled:cursor-not-allowed">
                    {pdfLoading === selectedBank.id
                      ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      : <ExternalLink className="h-3.5 w-3.5" />}
                    View PDF
                  </button>
                  <button type="button" onClick={() => setSelectedBank(null)} className="text-sm text-muted-foreground hover:underline">← Back to list</button>
                </div>
              </div>

              <div className="flex items-center gap-3 rounded-lg border p-4 bg-muted/10">
                <label className="text-sm font-medium whitespace-nowrap">Bank account (this statement)</label>
                <select value={bankAccountId} onChange={e => setBankAccountId(e.target.value)}
                  className="flex-1 rounded-md border bg-background px-3 py-1.5 text-sm">
                  <option value="">— select —</option>
                  {bankAccounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                </select>
              </div>

              {bankError && <p className="text-sm text-destructive">{bankError}</p>}

              <div className="rounded-lg border overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="px-3 py-2 text-left w-8">
                        <input type="checkbox" checked={Object.values(included).every(Boolean)}
                          onChange={e => { const v = e.target.checked; setIncluded(prev => Object.fromEntries(Object.keys(prev).map(k => [k, v]))); }} />
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase">Date</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase">Description</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground uppercase">Amount</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase">Type</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase min-w-[200px]">Offset account</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedBank.extracted_transactions.map((tx, i) => (
                      <tr key={i} className={`border-b ${!included[i] ? 'opacity-40' : ''}`}>
                        <td className="px-3 py-2">
                          <input type="checkbox" checked={included[i] ?? true}
                            onChange={e => setIncluded(prev => ({ ...prev, [i]: e.target.checked }))} />
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap font-mono text-xs">{tx.date}</td>
                        <td className="px-3 py-2 max-w-[220px] truncate">{tx.description}</td>
                        <td className={`px-3 py-2 text-right font-mono font-medium ${tx.type === 'credit' ? 'text-emerald-600' : 'text-destructive'}`}>
                          {tx.type === 'credit' ? '+' : '-'}{fmtMoney(tx.amount)}
                        </td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${tx.type === 'credit' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                            {tx.type === 'credit' ? 'Deposit' : 'Payment'}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <select disabled={!included[i]} value={offsets[i] ?? ''}
                            onChange={e => setOffsets(prev => ({ ...prev, [i]: e.target.value }))}
                            title={tx.suggested_offset ? `AI suggested: ${tx.suggested_offset}` : undefined}
                            className={`w-full rounded border bg-background px-2 py-1 text-xs disabled:opacity-40 ${offsets[i] ? 'border-emerald-400' : ''}`}>
                            <option value="">— select account —</option>
                            {accounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between pt-2">
                <button type="button" onClick={() => handleBankReject(selectedBank)}
                  className="inline-flex items-center gap-1.5 h-9 rounded-md border px-4 text-sm text-destructive hover:bg-destructive/10">
                  <XCircle className="h-4 w-4" />Reject all
                </button>
                <button type="button" onClick={handleBankApprove} disabled={bankPosting}
                  className="inline-flex items-center gap-1.5 h-9 rounded-md bg-emerald-600 text-white px-5 text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50">
                  <CheckCircle className="h-4 w-4" />
                  {bankPosting ? 'Posting…' : `Post ${Object.values(included).filter(Boolean).length} journal entries`}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── HISTORY TAB ─────────────────────────────────────────────────────── */}
      {!loading && topTab === 'history' && (
        <>
          {historyLoading && <p className="text-sm text-muted-foreground">Loading history…</p>}
          {!historyLoading && historyBank.length === 0 && historyInvoices.length === 0 && (
            <div className="rounded-lg border bg-muted/20 p-12 text-center">
              <History className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="font-medium">No history yet</p>
              <p className="text-sm text-muted-foreground mt-1">Approved and rejected imports will appear here.</p>
            </div>
          )}
          {!historyLoading && (historyBank.length > 0 || historyInvoices.length > 0) && (
            <div className="space-y-6">
              {historyBank.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-2"><CreditCard className="h-3.5 w-3.5" />Bank Statements</h3>
                  <div className="rounded-lg border divide-y">
                    {historyBank.map(imp => (
                      <div key={imp.id} className="flex items-center justify-between px-4 py-3">
                        <div className="min-w-0 flex items-center gap-3">
                          <div className="shrink-0 h-9 w-9 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center">
                            <CreditCard className="h-4 w-4" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold truncate">{deriveBankTitle(imp)}</p>
                            <p className="text-xs text-muted-foreground">{deriveBankSubtitle(imp)} · received {fmtDate(imp.received_at)}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 ml-4">
                          <button type="button" onClick={() => openPdf('bank', imp.id)}
                            disabled={pdfLoading === imp.id}
                            className="inline-flex h-7 items-center rounded-md border px-2.5 text-xs gap-1 transition-colors hover:bg-primary/5 hover:border-primary hover:text-primary disabled:opacity-50 disabled:cursor-not-allowed">
                            {pdfLoading === imp.id
                              ? <RefreshCw className="h-3 w-3 animate-spin" />
                              : <ExternalLink className="h-3 w-3" />}
                            PDF
                          </button>
                          <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold ${imp.status === 'approved' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                            {imp.status.toUpperCase()}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {historyInvoices.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-2"><FileText className="h-3.5 w-3.5" />Invoices</h3>
                  <div className="rounded-lg border divide-y">
                    {historyInvoices.map(imp => (
                      <div key={imp.id} className="flex items-center justify-between px-4 py-3">
                        <div className="min-w-0 flex items-center gap-3">
                          <span className={`shrink-0 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${imp.invoice_type === 'ap' ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                            {imp.invoice_type.toUpperCase()}
                          </span>
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{imp.vendor_customer ?? imp.email_subject ?? '(unknown)'}</p>
                            <p className="text-xs text-muted-foreground">#{imp.invoice_number ?? '—'} · {imp.invoice_date ?? '—'} · {imp.total ? fmtMoney(imp.total) : '—'}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 ml-4">
                          <button type="button" onClick={() => openPdf('invoice', imp.id)}
                            disabled={pdfLoading === imp.id}
                            className="inline-flex h-7 items-center rounded-md border px-2.5 text-xs gap-1 transition-colors hover:bg-primary/5 hover:border-primary hover:text-primary disabled:opacity-50 disabled:cursor-not-allowed">
                            {pdfLoading === imp.id
                              ? <RefreshCw className="h-3 w-3 animate-spin" />
                              : <ExternalLink className="h-3 w-3" />}
                            PDF
                          </button>
                          <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold ${imp.status === 'approved' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                            {imp.status.toUpperCase()}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ── INVOICES TAB ────────────────────────────────────────────────────── */}
      {!loading && topTab === 'invoice' && (
        <>
          {!selectedInvoice && (
            <div className="flex gap-1 rounded-lg border bg-muted/20 p-1 w-fit">
              {(['all', 'ap', 'ar'] as const).map(t => (
                <button key={t} type="button" onClick={() => setInvoiceTab(t)}
                  className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${invoiceTab === t ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
                  {t === 'all' ? 'All' : t === 'ap' ? 'AP — Bills' : 'AR — Invoices'}
                  <span className="ml-1.5 text-xs text-muted-foreground">
                    ({t === 'all' ? invoiceImports.length : invoiceImports.filter(im => im.invoice_type === t).length})
                  </span>
                </button>
              ))}
            </div>
          )}

          {filteredInvoices.length === 0 && !selectedInvoice && (
            <div className="rounded-lg border bg-muted/20 p-12 text-center">
              <FileText className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="font-medium">No pending {invoiceTab === 'all' ? '' : invoiceTab.toUpperCase() + ' '}invoices</p>
              <p className="text-sm text-muted-foreground mt-1">Email invoice PDFs to the firm inbox and label them <code className="text-xs bg-muted px-1 py-0.5 rounded">invoices</code>.</p>
            </div>
          )}

          {!selectedInvoice && filteredInvoices.length > 0 && (
            <div className="rounded-lg border divide-y">
              {filteredInvoices.map(imp => (
                <div key={imp.id} className="flex items-center justify-between px-4 py-3 hover:bg-muted/20">
                  <div className="min-w-0 flex items-center gap-3">
                    <span className={`shrink-0 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${imp.invoice_type === 'ap' ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                      {imp.invoice_type.toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{imp.vendor_customer ?? imp.email_subject ?? '(unknown)'}</p>
                      <p className="text-xs text-muted-foreground">#{imp.invoice_number ?? '—'} · {imp.invoice_date ?? '—'} · {imp.total ? fmtMoney(imp.total) : '—'} · {imp.line_items.length} lines</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-4">
                    <button type="button" onClick={() => openPdf('invoice', imp.id)}
                      disabled={pdfLoading === imp.id}
                      className="inline-flex h-8 items-center rounded-md border px-3 text-sm gap-1.5 transition-colors hover:bg-primary/5 hover:border-primary hover:text-primary disabled:opacity-50 disabled:cursor-not-allowed"
                      title="View original PDF">
                      {pdfLoading === imp.id
                        ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        : <ExternalLink className="h-3.5 w-3.5" />}
                      PDF
                    </button>
                    <button type="button" onClick={() => openInvoice(imp)}
                      className="inline-flex h-8 items-center rounded-md bg-primary text-primary-foreground px-3 text-sm font-medium hover:bg-primary/90">
                      Review
                    </button>
                    <button type="button" onClick={() => handleInvoiceReject(imp)}
                      className="inline-flex h-8 items-center rounded-md border px-3 text-sm text-destructive hover:bg-destructive/10">
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {selectedInvoice && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${selectedInvoice.invoice_type === 'ap' ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                    {selectedInvoice.invoice_type === 'ap' ? 'AP — Bill from Vendor' : 'AR — Invoice to Customer'}
                  </span>
                  <div>
                    <p className="font-medium">{selectedInvoice.vendor_customer ?? '(unknown)'} — Invoice #{selectedInvoice.invoice_number ?? '—'}</p>
                    <p className="text-xs text-muted-foreground">Date: {selectedInvoice.invoice_date ?? '—'} · Due: {selectedInvoice.due_date ?? '—'} · Received {fmtDate(selectedInvoice.received_at)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button type="button" onClick={() => openPdf('invoice', selectedInvoice.id)}
                    disabled={pdfLoading === selectedInvoice.id}
                    className="inline-flex h-8 items-center rounded-md border px-3 text-sm gap-1.5 transition-colors hover:bg-primary/5 hover:border-primary hover:text-primary disabled:opacity-50 disabled:cursor-not-allowed">
                    {pdfLoading === selectedInvoice.id
                      ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      : <ExternalLink className="h-3.5 w-3.5" />}
                    View PDF
                  </button>
                  <button type="button" onClick={() => setSelectedInvoice(null)} className="text-sm text-muted-foreground hover:underline">← Back</button>
                </div>
              </div>

              <div className="rounded-lg border p-4 bg-muted/10 space-y-3">
                {selectedInvoice.invoice_type === 'ap' ? (
                  <div className="flex items-center gap-3">
                    <label className="text-sm font-medium whitespace-nowrap w-52">Vendor</label>
                    <select value={selectedVendorId} onChange={e => setSelectedVendorId(e.target.value)}
                      className="flex-1 rounded-md border bg-background px-3 py-1.5 text-sm">
                      <option value="">— select vendor —</option>
                      {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                    </select>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <label className="text-sm font-medium whitespace-nowrap w-52">Customer</label>
                    <select value={selectedCustomerId} onChange={e => setSelectedCustomerId(e.target.value)}
                      className="flex-1 rounded-md border bg-background px-3 py-1.5 text-sm">
                      <option value="">— select customer —</option>
                      {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                )}
                {selectedInvoice.tax_amount && parseFloat(selectedInvoice.tax_amount) > 0 && (
                  <div className="flex items-center gap-3">
                    <label className="text-sm font-medium whitespace-nowrap w-52 flex items-center gap-2">
                      <input type="checkbox" checked={includeTax} onChange={e => setIncludeTax(e.target.checked)} />
                      Tax ({fmtMoney(selectedInvoice.tax_amount)})
                    </label>
                    {includeTax && (
                      <select value={taxAccountId} onChange={e => setTaxAccountId(e.target.value)}
                        className="flex-1 rounded-md border bg-background px-3 py-1.5 text-sm">
                        <option value="">— tax account —</option>
                        {accounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                      </select>
                    )}
                  </div>
                )}
              </div>

              {invError && <p className="text-sm text-destructive">{invError}</p>}

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
                        {selectedInvoice.invoice_type === 'ap' ? 'Expense account' : 'Revenue account'}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedInvoice.line_items.map((li, i) => (
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
                          <select disabled={!lineIncluded[i]} value={lineAccountIds[i] ?? ''}
                            onChange={e => setLineAccountIds(prev => ({ ...prev, [i]: e.target.value }))}
                            title={li.suggested_account ? `AI suggested: ${li.suggested_account}` : undefined}
                            className={`w-full rounded border bg-background px-2 py-1 text-xs disabled:opacity-40 ${lineAccountIds[i] ? 'border-emerald-400' : ''}`}>
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
                      <td className="px-3 py-2 text-right font-mono">{selectedInvoice.subtotal ? fmtMoney(selectedInvoice.subtotal) : '—'}</td>
                      <td />
                    </tr>
                    {selectedInvoice.tax_amount && parseFloat(selectedInvoice.tax_amount) > 0 && (
                      <tr className="bg-muted/10">
                        <td colSpan={4} className="px-3 py-2 text-right text-sm text-muted-foreground">Tax</td>
                        <td className="px-3 py-2 text-right font-mono text-muted-foreground">{fmtMoney(selectedInvoice.tax_amount)}</td>
                        <td />
                      </tr>
                    )}
                    <tr className="bg-muted/30 font-semibold border-t-2">
                      <td colSpan={4} className="px-3 py-2 text-right">Total</td>
                      <td className="px-3 py-2 text-right font-mono">{selectedInvoice.total ? fmtMoney(selectedInvoice.total) : '—'}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>

              <div className="flex items-center justify-between pt-2">
                <button type="button" onClick={() => handleInvoiceReject(selectedInvoice)}
                  className="inline-flex items-center gap-1.5 h-9 rounded-md border px-4 text-sm text-destructive hover:bg-destructive/10">
                  <XCircle className="h-4 w-4" />Reject
                </button>
                <button type="button" onClick={handleInvoiceApprove} disabled={invPosting}
                  className="inline-flex items-center gap-1.5 h-9 rounded-md bg-emerald-600 text-white px-5 text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50">
                  <CheckCircle className="h-4 w-4" />
                  {invPosting ? 'Posting…' : selectedInvoice.invoice_type === 'ap' ? 'Post as Bill' : 'Post as Invoice'}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
