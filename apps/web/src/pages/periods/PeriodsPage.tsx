import { useEffect, useState } from 'react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { useAuth } from '@/auth/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DownloadButtons } from '@/components/ui/DownloadButtons';
import { currentYearLocal } from '@/lib/dates';

type Period = { id: string; starts_on: string; ends_on: string; status: 'open' | 'closed'; closed_at: string | null };

function pickErr(e: unknown): string {
  return (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message ?? 'Failed';
}

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Fiscal Periods</h1>
        <div className="flex items-center gap-2">
          <DownloadButtons
            headers={['Start', 'End', 'Status', 'Closed At']}
            getRows={() => periods.map(p => [p.starts_on, p.ends_on, p.status, p.closed_at ?? '—'])}
            filename="fiscal-periods"
            title="Fiscal Periods"
          />
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
