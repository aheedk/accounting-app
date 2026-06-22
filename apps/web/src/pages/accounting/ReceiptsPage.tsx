import { useCallback, useEffect, useRef, useState } from 'react';
import { FileDown, Printer } from 'lucide-react';
import { downloadAsExcel } from '@/lib/download';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/EmptyState';
import { fmtMoney } from '@/lib/money';

type LinkedEntityType =
  | 'bank_transaction'
  | 'bill'
  | 'expense_transaction'
  | 'invoice'
  | 'journal_entry'
  | 'unlinked';

type Receipt = {
  id: string;
  business_id: string;
  file_id: string;
  uploaded_by_user_id: string;
  linked_entity_type: LinkedEntityType;
  linked_entity_id: string | null;
  created_at: string;
  updated_at: string;
};

type FileRow = {
  id: string;
  original_name: string;
  mime_type: string;
  byte_size: number;
  storage_path: string;
};

type Bill = { id: string; bill_number: string; vendor_id: string; total: string };
type BankTxn = { id: string; description: string; amount: string; transaction_date: string };
type ExpenseTxn = { id: string; transaction_date: string; payee_text: string | null; amount: string };

type ReceiptListResponse = { receipts: Receipt[] };

const LINK_TYPES: Array<{ value: LinkedEntityType; label: string }> = [
  { value: 'unlinked', label: 'Unlinked' },
  { value: 'bank_transaction', label: 'Bank Transaction' },
  { value: 'bill', label: 'Bill' },
  { value: 'expense_transaction', label: 'Expense Transaction' },
  { value: 'invoice', label: 'Invoice' },
  { value: 'journal_entry', label: 'Journal Entry' },
];

function pickErr(e: unknown): string {
  return (e as { response?: { data?: { error?: { message?: string } } } } | undefined)
    ?.response?.data?.error?.message ?? 'Failed';
}

function entityBadge(type: LinkedEntityType) {
  const base = 'inline-flex rounded-full px-2 py-0.5 text-xs font-medium';
  switch (type) {
    case 'unlinked':
      return <span className={`${base} bg-muted text-muted-foreground`}>unlinked</span>;
    case 'bank_transaction':
      return <span className={`${base} bg-sky-100 text-sky-800`}>bank txn</span>;
    case 'bill':
      return <span className={`${base} bg-amber-100 text-amber-800`}>bill</span>;
    case 'expense_transaction':
      return <span className={`${base} bg-orange-100 text-orange-800`}>expense</span>;
    case 'invoice':
      return <span className={`${base} bg-emerald-100 text-emerald-800`}>invoice</span>;
    case 'journal_entry':
      return <span className={`${base} bg-violet-100 text-violet-800`}>journal</span>;
    default:
      return <span className={base}>{type}</span>;
  }
}

function mimeIcon(mime: string): string {
  if (mime.startsWith('image/')) return 'IMG';
  if (mime === 'application/pdf') return 'PDF';
  if (mime.startsWith('text/')) return 'TXT';
  return 'FILE';
}

export default function ReceiptsPage() {
  const [bizId] = useActiveBusinessId();
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [files, setFiles] = useState<Record<string, FileRow>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [excelBusy, setExcelBusy] = useState(false);
  const [filter, setFilter] = useState<LinkedEntityType | 'all'>('all');

  // Upload state
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Link dialog state
  const [linkTarget, setLinkTarget] = useState<Receipt | null>(null);
  const [linkType, setLinkType] = useState<LinkedEntityType>('unlinked');
  const [linkId, setLinkId] = useState<string>('');
  const [linkErr, setLinkErr] = useState<string | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);

  // Lazy-loaded option lists for the link dialog dropdowns.
  const [bills, setBills] = useState<Bill[]>([]);
  const [bankTxns, setBankTxns] = useState<BankTxn[]>([]);
  const [expenseTxns, setExpenseTxns] = useState<ExpenseTxn[]>([]);

  const reload = useCallback(async () => {
    if (!bizId) return;
    setErr(null);
    try {
      const params: { entity_type?: LinkedEntityType } = {};
      if (filter !== 'all') params.entity_type = filter;
      const r = await api.get<ReceiptListResponse>(`/businesses/${bizId}/receipts`, { params });
      const list = r.data.receipts;
      setReceipts(list);
      // Hydrate file metadata for each receipt. Files endpoint isn't a list, so we fetch
      // each unknown file_id one at a time. Cheap for small counts; can paginate later.
      const known = new Set(Object.keys(files));
      const missing = list.map(rc => rc.file_id).filter(id => !known.has(id));
      if (missing.length > 0) {
        const fetched: Record<string, FileRow> = {};
        await Promise.all(missing.map(async fid => {
          try {
            const fr = await api.get<{ file: FileRow }>(`/businesses/${bizId}/files/${fid}`);
            fetched[fid] = fr.data.file;
          } catch {
            // If the file metadata endpoint doesn't exist, fall back to a placeholder.
            fetched[fid] = { id: fid, original_name: fid.slice(0, 8), mime_type: 'application/octet-stream', byte_size: 0, storage_path: '' };
          }
        }));
        setFiles(prev => ({ ...prev, ...fetched }));
      }
    } catch (e: unknown) {
      setErr(pickErr(e));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bizId, filter]);

  useEffect(() => { reload(); }, [reload]);

  async function loadOptionsFor(type: LinkedEntityType) {
    if (!bizId) return;
    try {
      if (type === 'bill' && bills.length === 0) {
        const r = await api.get<{ bills: Bill[] }>(`/businesses/${bizId}/bills`);
        setBills(r.data.bills);
      } else if (type === 'bank_transaction' && bankTxns.length === 0) {
        const r = await api.get<{ bank_transactions: BankTxn[] }>(`/businesses/${bizId}/bank-transactions`);
        setBankTxns(r.data.bank_transactions);
      } else if (type === 'expense_transaction' && expenseTxns.length === 0) {
        const r = await api.get<{ expense_transactions: ExpenseTxn[] }>(`/businesses/${bizId}/expense-transactions`);
        setExpenseTxns(r.data.expense_transactions);
      }
    } catch {
      // Non-fatal — user can fall back to free-text UUID entry.
    }
  }

  async function upload() {
    if (!bizId || !uploadFile) return;
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append('file', uploadFile);
      // Axios sets the multipart Content-Type (with boundary) automatically when the body is FormData.
      const fr = await api.post<FileRow>(`/businesses/${bizId}/files`, fd);
      const fileId = fr.data.id;
      // Register a receipt referencing the file. Defaults to unlinked.
      await api.post(`/businesses/${bizId}/receipts`, { file_id: fileId });
      // Cache file metadata locally so the row renders immediately on refetch.
      setFiles(prev => ({ ...prev, [fileId]: fr.data }));
      setUploadFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      await reload();
    } catch (e: unknown) {
      setErr(pickErr(e));
    } finally {
      setBusy(false);
    }
  }

  async function downloadFile(fileId: string, originalName: string) {
    if (!bizId) return;
    try {
      const r = await api.get(`/businesses/${bizId}/files/${fileId}/download`, { responseType: 'blob' });
      const blob = r.data as Blob;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = originalName || fileId;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Revoke after a tick so the browser can finish the download.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e: unknown) {
      setErr(pickErr(e));
    }
  }

  function openLink(receipt: Receipt) {
    setLinkTarget(receipt);
    setLinkType(receipt.linked_entity_type);
    setLinkId(receipt.linked_entity_id ?? '');
    setLinkErr(null);
    void loadOptionsFor(receipt.linked_entity_type);
  }

  function closeLink() {
    setLinkTarget(null);
    setLinkErr(null);
    setLinkBusy(false);
  }

  async function submitLink(e: React.FormEvent) {
    e.preventDefault();
    if (!bizId || !linkTarget) return;
    setLinkBusy(true);
    setLinkErr(null);
    try {
      const body: { linked_entity_type: LinkedEntityType; linked_entity_id: string | null } = {
        linked_entity_type: linkType,
        linked_entity_id: linkType === 'unlinked' ? null : (linkId.trim() || null),
      };
      await api.patch(`/businesses/${bizId}/receipts/${linkTarget.id}/link`, body);
      closeLink();
      await reload();
    } catch (e: unknown) {
      setLinkErr(pickErr(e));
    } finally {
      setLinkBusy(false);
    }
  }

  if (!bizId) return <div>Pick a business.</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Receipts</h1>
        <div className="flex items-center gap-2">
          <div className="relative group">
            <button className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50" onClick={() => { setExcelBusy(true); try { downloadAsExcel(['ID', 'Linked To', 'Created At'], receipts.map(r => [r.id, r.linked_entity_type, r.created_at]), 'receipts'); } finally { setExcelBusy(false); } }} disabled={excelBusy} aria-label="Export to Excel">
              <FileDown className="h-4 w-4" />
            </button>
            <div className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">Export to Excel</div>
          </div>
          <div className="relative group">
            <button className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground" onClick={() => { const hdrs = ['ID', 'Linked To', 'Created At']; const rowsHtml = receipts.map(r => `<tr><td>${r.id}</td><td>${r.linked_entity_type}</td><td>${r.created_at}</td></tr>`).join(''); const win = window.open('', '_blank'); if (!win) return; win.document.write(`<!DOCTYPE html><html><head><title>Receipts</title><style>body{font-family:Arial,sans-serif;font-size:11px;margin:24px}h2{margin-bottom:4px}p{color:#666;font-size:10px;margin-bottom:16px}table{width:100%;border-collapse:collapse}th{background:#f0f0f0;text-align:left;padding:5px 7px;border-bottom:2px solid #ccc;font-size:10px;text-transform:uppercase}td{padding:4px 7px;border-bottom:1px solid #e5e5e5}</style></head><body><h2>Receipts</h2><p>Generated ${new Date().toLocaleDateString()}</p><table><thead><tr>${hdrs.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rowsHtml}</tbody></table><script>window.onload=function(){window.print()}<\/script></body></html>`); win.document.close(); }} aria-label="Print">
              <Printer className="h-4 w-4" />
            </button>
            <div className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">Print</div>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle>Upload receipt</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[240px]">
              <Label>File</Label>
              <input
                ref={fileInputRef}
                type="file"
                className="block w-full text-sm file:mr-3 file:rounded-md file:border file:bg-background file:px-3 file:py-1.5 file:text-sm hover:file:bg-muted"
                onChange={e => setUploadFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <Button type="button" disabled={busy || !uploadFile} onClick={upload}>
              {busy ? 'Uploading…' : 'Upload'}
            </Button>
          </div>
          {err && <p className="text-sm text-destructive">{err}</p>}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-end gap-4">
        <div>
          <div className="mb-1 text-xs text-muted-foreground">Linked to</div>
          <select
            className="h-9 rounded-md border bg-background px-3 text-sm"
            value={filter}
            onChange={e => setFilter(e.target.value as LinkedEntityType | 'all')}
          >
            <option value="all">All receipts</option>
            {LINK_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40">
              <tr className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <th className="text-left p-3">Uploaded</th>
                <th className="text-left p-3">Type</th>
                <th className="text-left p-3">File</th>
                <th className="text-left p-3">Linked to</th>
                <th className="text-left p-3">Entity ID</th>
                <th className="text-right p-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {receipts.length === 0 && (
                <tr><td colSpan={6} className="p-0"><EmptyState title="No receipts yet" hint="Upload a receipt above, then link it to a bill, expense, or bank transaction." /></td></tr>
              )}
              {receipts.map(r => {
                const f = files[r.file_id];
                const name = f?.original_name ?? r.file_id.slice(0, 8);
                const mime = f?.mime_type ?? '';
                return (
                  <tr key={r.id} className="border-b last:border-b-0 hover:bg-muted/30">
                    <td className="p-3 whitespace-nowrap">{new Date(r.created_at).toLocaleDateString()}</td>
                    <td className="p-3 font-mono text-xs">{mime ? mimeIcon(mime) : '—'}</td>
                    <td className="p-3">
                      <button
                        type="button"
                        className="text-primary underline"
                        onClick={() => downloadFile(r.file_id, name)}
                      >
                        {name}
                      </button>
                    </td>
                    <td className="p-3">{entityBadge(r.linked_entity_type)}</td>
                    <td className="p-3 font-mono text-xs">{r.linked_entity_id ?? '—'}</td>
                    <td className="p-3 text-right">
                      <Button size="sm" variant="outline" onClick={() => openLink(r)}>Link…</Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {linkTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <Card className="w-full max-w-lg">
            <CardHeader><CardTitle>Link receipt</CardTitle></CardHeader>
            <CardContent>
              <form className="space-y-3" onSubmit={submitLink}>
                <div>
                  <Label>Entity type</Label>
                  <select
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                    value={linkType}
                    onChange={e => {
                      const v = e.target.value as LinkedEntityType;
                      setLinkType(v);
                      setLinkId('');
                      void loadOptionsFor(v);
                    }}
                  >
                    {LINK_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>

                {linkType === 'unlinked' && (
                  <p className="text-sm text-muted-foreground">No entity ID needed for unlinked receipts.</p>
                )}

                {linkType === 'bank_transaction' && (
                  <div>
                    <Label>Bank transaction</Label>
                    <select
                      className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                      value={linkId}
                      onChange={e => setLinkId(e.target.value)}
                      required
                    >
                      <option value="">Select…</option>
                      {bankTxns.map(t => (
                        <option key={t.id} value={t.id}>
                          {t.transaction_date} · {t.description.slice(0, 40)} · {fmtMoney(t.amount)}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {linkType === 'bill' && (
                  <div>
                    <Label>Bill</Label>
                    <select
                      className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                      value={linkId}
                      onChange={e => setLinkId(e.target.value)}
                      required
                    >
                      <option value="">Select…</option>
                      {bills.map(b => (
                        <option key={b.id} value={b.id}>
                          {b.bill_number} · {fmtMoney(b.total)}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {linkType === 'expense_transaction' && (
                  <div>
                    <Label>Expense transaction</Label>
                    <select
                      className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                      value={linkId}
                      onChange={e => setLinkId(e.target.value)}
                      required
                    >
                      <option value="">Select…</option>
                      {expenseTxns.map(t => (
                        <option key={t.id} value={t.id}>
                          {t.transaction_date} · {(t.payee_text ?? '').slice(0, 40)} · {fmtMoney(t.amount)}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {(linkType === 'invoice' || linkType === 'journal_entry') && (
                  <div>
                    <Label>{linkType === 'invoice' ? 'Invoice' : 'Journal entry'} ID</Label>
                    <Input
                      value={linkId}
                      onChange={e => setLinkId(e.target.value)}
                      placeholder="UUID"
                      required
                    />
                    <p className="mt-1 text-xs text-muted-foreground">Paste the entity UUID. Picker coming in a later slice.</p>
                  </div>
                )}

                {linkErr && <p className="text-sm text-destructive">{linkErr}</p>}

                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="ghost" onClick={closeLink} disabled={linkBusy}>Cancel</Button>
                  <Button type="submit" disabled={linkBusy}>{linkBusy ? 'Saving…' : 'Save link'}</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
