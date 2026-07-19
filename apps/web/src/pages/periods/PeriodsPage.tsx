import { useEffect, useState } from 'react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { useAuth } from '@/auth/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { FileDown, Printer } from 'lucide-react';
import { downloadAsExcel } from '@/lib/download';
import { currentYearLocal } from '@/lib/dates';
import { pickErr } from '@/lib/apiErrors';

type Period = { id: string; starts_on: string; ends_on: string; status: 'open' | 'closed'; closed_at: string | null };


function fmtShortDate(iso: string) {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${Number(m)}/${Number(d)}/${y.slice(2)}`;
}

function statusBadge(status: 'open' | 'closed') {
  const base = 'inline-flex rounded-full px-2 py-0.5 text-xs font-medium';
  return status === 'open'
    ? <span className={`${base} bg-emerald-100 text-emerald-800`}>Open</span>
    : <span className={`${base} bg-muted text-muted-foreground`}>Closed</span>;
}

export default function PeriodsPage() {
  const [bizId] = useActiveBusinessId();
  const { user } = useAuth();
  const [periods, setPeriods] = useState<Period[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [excelBusy, setExcelBusy] = useState(false);

  async function reload() {
    if (!bizId) return;
    const r = await api.get(`/businesses/${bizId}/periods`);
    setPeriods(r.data.periods);
  }
  useEffect(() => { reload(); }, [bizId]);

  async function close(p: Period) {
    const memo = window.prompt('Optional memo for closing this period:');
    setBusy(p.id); setErr(null);
    try {
      await api.post(`/businesses/${bizId}/periods/${p.id}/close`, { memo: memo && memo.length > 0 ? memo : null });
      await reload();
    }
    catch (e: unknown) { setErr(pickErr(e)); }
    finally { setBusy(null); }
  }

  async function reopen(p: Period) {
    const reason = window.prompt('Reason for reopening:');
    if (!reason || reason.length === 0) return;
    setBusy(p.id); setErr(null);
    try {
      await api.post(`/businesses/${bizId}/periods/${p.id}/reopen`, { reason });
      await reload();
    }
    catch (e: unknown) { setErr(pickErr(e)); }
    finally { setBusy(null); }
  }

  async function seedYear() {
    const yearStr = window.prompt('Year to seed?', String(currentYearLocal() + 1));
    if (!yearStr) return;
    setErr(null);
    try { await api.post(`/businesses/${bizId}/periods/seed-year`, { year: parseInt(yearStr, 10) }); await reload(); }
    catch (e: unknown) { setErr(pickErr(e)); }
  }

  if (!bizId) return <div>Pick a business.</div>;

  const canReopen = user?.role === 'firm_admin';
  const dlHeaders = ['Start', 'End', 'Status', 'Closed At'];
  const dlRows = () => periods.map(p => [p.starts_on, p.ends_on, p.status, p.closed_at ?? '—']);

  function handleExport() {
    setExcelBusy(true);
    try { downloadAsExcel(dlHeaders, dlRows(), 'fiscal-periods'); } finally { setExcelBusy(false); }
  }

  function handlePrint() {
    const rowsHtml = dlRows().map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('');
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><title>Fiscal Periods</title><style>body{font-family:Arial,sans-serif;font-size:11px;margin:24px}h2{margin-bottom:4px}p{color:#666;font-size:10px;margin-bottom:16px}table{width:100%;border-collapse:collapse}th{background:#f0f0f0;text-align:left;padding:5px 7px;border-bottom:2px solid #ccc;font-size:10px;text-transform:uppercase}td{padding:4px 7px;border-bottom:1px solid #e5e5e5}</style></head><body><h2>Fiscal Periods</h2><p>Generated ${new Date().toLocaleDateString()}</p><table><thead><tr>${dlHeaders.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rowsHtml}</tbody></table><script>window.onload=function(){window.print()}<\/script></body></html>`);
    win.document.close();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Fiscal Periods</h1>
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
          <Button onClick={seedYear}>Seed a year</Button>
        </div>
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <Card><CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40">
            <tr className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <th className="text-left p-3">Starts</th>
              <th className="text-left p-3">Ends</th>
              <th className="text-left p-3">Status</th>
              <th className="text-left p-3">Closed</th>
              <th className="text-left p-3">Action</th>
            </tr>
          </thead>
          <tbody>
            {periods.length === 0 && (
              <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">No fiscal periods yet. Use “Seed a year” to create them.</td></tr>
            )}
            {periods.map(p => (
              <tr key={p.id} className="border-b last:border-b-0 hover:bg-muted/30">
                <td className="p-3 whitespace-nowrap">{fmtShortDate(p.starts_on)}</td>
                <td className="p-3 whitespace-nowrap">{fmtShortDate(p.ends_on)}</td>
                <td className="p-3">{statusBadge(p.status)}</td>
                <td className="p-3 whitespace-nowrap">{p.closed_at ? new Date(p.closed_at).toLocaleDateString() : <span className="text-muted-foreground">—</span>}</td>
                <td className="p-3">
                  {p.status === 'open' && (
                    <Button size="sm" variant="outline" disabled={busy === p.id} onClick={() => close(p)}>Close</Button>
                  )}
                  {p.status === 'closed' && canReopen && (
                    <Button size="sm" variant="outline" disabled={busy === p.id} onClick={() => reopen(p)}>Reopen</Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent></Card>
    </div>
  );
}
