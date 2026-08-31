import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, CheckCircle, XCircle } from 'lucide-react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { fmtMoney } from '@/lib/money';

type ExtractedTx = {
  date: string;
  description: string;
  amount: string;
  type: 'debit' | 'credit';
  balance: string;
  suggested_offset?: string;
};

type StagedImport = {
  id: string;
  email_from: string | null;
  email_subject: string | null;
  received_at: string;
  extracted_transactions: ExtractedTx[];
  status: string;
};

type CoaAccount = { id: string; code: string; name: string; account_type: string };

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function EmailImportReviewPage() {
  const [bizId] = useActiveBusinessId();
  const nav = useNavigate();

  const [imports, setImports] = useState<StagedImport[]>([]);
  const [accounts, setAccounts] = useState<CoaAccount[]>([]);
  const [loading, setLoading] = useState(true);

  // Per-import state
  const [selectedImport, setSelectedImport] = useState<StagedImport | null>(null);
  const [bankAccountId, setBankAccountId] = useState('');
  const [offsets, setOffsets] = useState<Record<number, string>>({});
  const [included, setIncluded] = useState<Record<number, boolean>>({});
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!bizId) return;
    setLoading(true);
    Promise.all([
      api.get(`/businesses/${bizId}/email-imports`),
      api.get(`/businesses/${bizId}/coa`),
    ]).then(([importsRes, coaRes]) => {
      setImports((importsRes.data.imports as StagedImport[]) ?? []);
      setAccounts((coaRes.data.accounts as CoaAccount[]) ?? []);
    }).catch((e: unknown) => { console.error('email-imports load failed', e); }).finally(() => setLoading(false));
  }, [bizId]);

  function openImport(imp: StagedImport) {
    setSelectedImport(imp);
    setBankAccountId('');
    setError(null);
    const initIncluded: Record<number, boolean> = {};
    const initOffsets: Record<number, string> = {};
    imp.extracted_transactions.forEach((tx, i) => {
      initIncluded[i] = true;
      if (tx.suggested_offset) {
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

  async function handleApprove() {
    if (!bizId || !selectedImport) return;
    if (!bankAccountId) { setError('Select a bank account first.'); return; }
    const missing = selectedImport.extracted_transactions.findIndex((_, i) => included[i] && !offsets[i]);
    if (missing !== -1) { setError(`Select an offset account for row ${missing + 1}.`); return; }

    setPosting(true);
    setError(null);
    try {
      const transactions = selectedImport.extracted_transactions.map((_, i) => ({
        index: i,
        offset_account_id: offsets[i] ?? '',
        include: included[i] ?? true,
      }));
      await api.post(`/businesses/${bizId}/email-imports/${selectedImport.id}/approve`, {
        bank_account_id: bankAccountId,
        transactions,
      });
      setImports(prev => prev.filter(im => im.id !== selectedImport.id));
      setSelectedImport(null);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to post journal entries';
      setError(msg);
    } finally {
      setPosting(false);
    }
  }

  async function handleReject(imp: StagedImport) {
    if (!bizId) return;
    await api.post(`/businesses/${bizId}/email-imports/${imp.id}/reject`, {});
    setImports(prev => prev.filter(im => im.id !== imp.id));
    if (selectedImport?.id === imp.id) setSelectedImport(null);
  }

  const bankAccounts = accounts.filter(a => a.account_type === 'asset');

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
          <p className="text-sm text-muted-foreground">Review AI-extracted bank statement transactions before posting to the ledger.</p>
        </div>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {!loading && imports.length === 0 && !selectedImport && (
        <div className="rounded-lg border bg-muted/20 p-12 text-center">
          <CheckCircle className="h-10 w-10 text-emerald-500 mx-auto mb-3" />
          <p className="font-medium">No pending imports</p>
          <p className="text-sm text-muted-foreground mt-1">Bank statement emails will appear here automatically when received.</p>
        </div>
      )}

      {/* Import list */}
      {!selectedImport && imports.length > 0 && (
        <div className="rounded-lg border divide-y">
          {imports.map(imp => (
            <div key={imp.id} className="flex items-center justify-between px-4 py-3 hover:bg-muted/20">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{imp.email_subject ?? '(no subject)'}</p>
                <p className="text-xs text-muted-foreground">{imp.email_from} · {fmtDate(imp.received_at)} · {imp.extracted_transactions.length} transactions</p>
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-4">
                <button
                  type="button"
                  onClick={() => openImport(imp)}
                  className="inline-flex h-8 items-center rounded-md bg-primary text-primary-foreground px-3 text-sm font-medium hover:bg-primary/90"
                >
                  Review
                </button>
                <button
                  type="button"
                  onClick={() => handleReject(imp)}
                  className="inline-flex h-8 items-center rounded-md border px-3 text-sm text-destructive hover:bg-destructive/10"
                >
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
            <div>
              <p className="font-medium">{selectedImport.email_subject ?? '(no subject)'}</p>
              <p className="text-xs text-muted-foreground">{selectedImport.email_from} · received {fmtDate(selectedImport.received_at)}</p>
            </div>
            <button type="button" onClick={() => setSelectedImport(null)} className="text-sm text-muted-foreground hover:underline">← Back to list</button>
          </div>

          {/* Bank account selector */}
          <div className="flex items-center gap-3 rounded-lg border p-4 bg-muted/10">
            <label className="text-sm font-medium whitespace-nowrap">Bank account (this statement)</label>
            <select
              value={bankAccountId}
              onChange={e => setBankAccountId(e.target.value)}
              className="flex-1 rounded-md border bg-background px-3 py-1.5 text-sm"
            >
              <option value="">— select —</option>
              {bankAccounts.map(a => (
                <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
              ))}
            </select>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          {/* Transactions table */}
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
                {selectedImport.extracted_transactions.map((tx, i) => (
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
                      <select
                        disabled={!included[i]}
                        value={offsets[i] ?? ''}
                        onChange={e => setOffsets(prev => ({ ...prev, [i]: e.target.value }))}
                        title={tx.suggested_offset ? `AI suggested: ${tx.suggested_offset}` : undefined}
                        className={`w-full rounded border bg-background px-2 py-1 text-xs disabled:opacity-40 ${offsets[i] ? 'border-emerald-400' : ''}`}
                      >
                        <option value="">— select account —</option>
                        {accounts.map(a => (
                          <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={() => handleReject(selectedImport)}
              className="inline-flex items-center gap-1.5 h-9 rounded-md border px-4 text-sm text-destructive hover:bg-destructive/10"
            >
              <XCircle className="h-4 w-4" />Reject all
            </button>
            <button
              type="button"
              onClick={handleApprove}
              disabled={posting}
              className="inline-flex items-center gap-1.5 h-9 rounded-md bg-emerald-600 text-white px-5 text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50"
            >
              <CheckCircle className="h-4 w-4" />
              {posting ? 'Posting…' : `Post ${Object.values(included).filter(Boolean).length} journal entries`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
