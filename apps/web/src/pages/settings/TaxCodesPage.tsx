import { useEffect, useState } from 'react';
import { DateInput } from '@/components/ui/date-input';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FileDown, Printer } from 'lucide-react';
import { downloadAsExcel } from '@/lib/download';

type TaxCode = { id: string; code: string; name: string; current_rate: string | null; is_active: boolean };
type Account = { id: string; code: string; name: string; account_type: string; is_system: boolean; is_active: boolean };

export default function TaxCodesPage() {
  const [bizId] = useActiveBusinessId();
  const [items, setItems] = useState<TaxCode[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', tax_payable_account_id: '', rate: '0.0875', effective_from: '2026-01-01' });
  const [err, setErr] = useState<string | null>(null);
  const [excelBusy, setExcelBusy] = useState(false);

  async function reload() {
    if (!bizId) return;
    const r = await api.get(`/businesses/${bizId}/tax-codes`);
    setItems(r.data.tax_codes);
    const a = await api.get(`/businesses/${bizId}/coa`);
    setAccounts(a.data.accounts.filter((x: Account) => x.account_type === 'liability' && x.is_active));
  }
  useEffect(() => { reload(); }, [bizId]);

  async function create(e: React.FormEvent) {
    e.preventDefault(); setErr(null);
    try {
      await api.post(`/businesses/${bizId}/tax-codes`, {
        code: form.code, name: form.name, tax_payable_account_id: form.tax_payable_account_id,
        initial_rate: { rate: parseFloat(form.rate), effective_from: form.effective_from, effective_to: null },
      });
      setShow(false); setForm({ code: '', name: '', tax_payable_account_id: '', rate: '0.0875', effective_from: '2026-01-01' });
      await reload();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
      setErr(msg ?? 'Failed');
    }
  }

  if (!bizId) return <div>Pick a business.</div>;

  const dlHeaders = ['Code', 'Name', 'Current Rate', 'Active'];
  const dlRows = () => items.map(c => [c.code, c.name, c.current_rate ? String(parseFloat((parseFloat(c.current_rate) * 100).toFixed(4))) + '%' : '—', c.is_active ? 'Yes' : 'No']);

  function handleExport() {
    setExcelBusy(true);
    try { downloadAsExcel(dlHeaders, dlRows(), 'tax-codes'); } finally { setExcelBusy(false); }
  }

  function handlePrint() {
    const rowsHtml = dlRows().map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('');
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><title>Tax Codes</title><style>body{font-family:Arial,sans-serif;font-size:11px;margin:24px}h2{margin-bottom:4px}p{color:#666;font-size:10px;margin-bottom:16px}table{width:100%;border-collapse:collapse}th{background:#f0f0f0;text-align:left;padding:5px 7px;border-bottom:2px solid #ccc;font-size:10px;text-transform:uppercase}td{padding:4px 7px;border-bottom:1px solid #e5e5e5}</style></head><body><h2>Tax Codes</h2><p>Generated ${new Date().toLocaleDateString()}</p><table><thead><tr>${dlHeaders.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rowsHtml}</tbody></table><script>window.onload=function(){window.print()}<\/script></body></html>`);
    win.document.close();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Tax Codes</h1>
        <div className="flex items-center gap-2">
          <div className="relative group">
            <button className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50" onClick={handleExport} disabled={excelBusy} aria-label="Export to Excel">
              <FileDown className="h-4 w-4" />
            </button>
            <div className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">Export to Excel</div>
          </div>
          <div className="relative group">
            <button className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground" onClick={handlePrint} aria-label="Print">
              <Printer className="h-4 w-4" />
            </button>
            <div className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">Print</div>
          </div>
          <Button onClick={() => setShow(s => !s)}>{show ? 'Cancel' : 'New tax code'}</Button>
        </div>
      </div>
      {show && (
        <Card><CardHeader><CardTitle>Create</CardTitle></CardHeader>
          <CardContent>
            <form className="grid grid-cols-3 gap-3 items-end" onSubmit={create}>
              <div><Label>Code</Label><Input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} required /></div>
              <div><Label>Name</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required /></div>
              <div><Label>Payable account</Label>
                <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.tax_payable_account_id} onChange={e => setForm(f => ({ ...f, tax_payable_account_id: e.target.value }))} required>
                  <option value="">Select…</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                </select>
              </div>
              <div><Label>Rate (decimal, e.g. 0.0875)</Label><Input type="number" step="0.000001" value={form.rate} onChange={e => setForm(f => ({ ...f, rate: e.target.value }))} required /></div>
              <div><Label>Effective from</Label><DateInput value={form.effective_from} onChange={e => setForm(f => ({ ...f, effective_from: e.target.value }))} required /></div>
              <Button type="submit">Create</Button>
              {err && <p className="text-sm text-destructive col-span-3">{err}</p>}
            </form>
          </CardContent>
        </Card>
      )}
      <Card><CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40"><tr><th className="text-left p-3">Code</th><th className="text-left p-3">Name</th><th className="text-right p-3">Current rate</th><th className="text-left p-3">Active</th></tr></thead>
          <tbody>{items.map(c => (<tr key={c.id} className="border-b last:border-b-0">
            <td className="p-3 font-mono">{c.code}</td>
            <td className="p-3">{c.name}</td>
            <td className="p-3 text-right">{c.current_rate ? `${parseFloat((parseFloat(c.current_rate) * 100).toFixed(4))}%` : '—'}</td>
            <td className="p-3">{c.is_active ? 'yes' : 'no'}</td>
          </tr>))}</tbody>
        </table>
      </CardContent></Card>
    </div>
  );
}
