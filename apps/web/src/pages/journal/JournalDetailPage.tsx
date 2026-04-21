import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fmtMoney } from '@/lib/money';

type JELine = {
  id: string; line_number: number; account_id: string;
  account_code: string; account_name: string;
  debit: string; credit: string; memo: string | null;
};
type JEData = {
  entry: {
    id: string; entry_date: string; status: string; memo: string | null;
    reference: string | null; source_type: string; reversed_entry_id: string | null;
  };
  lines: JELine[];
};

function pickErr(e: unknown): string {
  return (e as { response?: { data?: { error?: { message?: string } } } } | undefined)
    ?.response?.data?.error?.message ?? 'Failed';
}

export default function JournalDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [bizId] = useActiveBusinessId();
  const [data, setData] = useState<JEData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  useEffect(() => {
    if (bizId && id) api.get(`/businesses/${bizId}/journal-entries/${id}`).then(r => setData(r.data));
  }, [bizId, id]);

  async function voidIt() {
    const reason = window.prompt('Reason for voiding?');
    if (!reason) return;
    setBusy(true); setErr(null);
    try { await api.post(`/businesses/${bizId}/journal-entries/${id}/void`, { void_reason: reason }); nav('/journal'); }
    catch (e: unknown) { setErr(pickErr(e)); }
    finally { setBusy(false); }
  }

  if (!data) return <div>Loading…</div>;
  const totalD = data.lines.reduce((s, l) => s + parseFloat(l.debit), 0);
  const totalC = data.lines.reduce((s, l) => s + parseFloat(l.credit), 0);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Journal Entry</h1>
      <Card>
        <CardHeader><CardTitle>{data.entry.entry_date} — {data.entry.status}</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div>Memo: {data.entry.memo ?? '—'}</div>
          <div>Reference: {data.entry.reference ?? '—'}</div>
          <div>Source: {data.entry.source_type}</div>
          {data.entry.reversed_entry_id && <div>Reverses: {data.entry.reversed_entry_id}</div>}
        </CardContent>
      </Card>

      <Card><CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40">
            <tr><th className="text-left p-3">#</th><th className="text-left p-3">Account</th><th className="text-right p-3">Debit</th><th className="text-right p-3">Credit</th><th className="text-left p-3">Memo</th></tr>
          </thead>
          <tbody>
            {data.lines.map(l => (
              <tr key={l.id} className="border-b last:border-b-0">
                <td className="p-3">{l.line_number}</td>
                <td className="p-3 font-mono">{l.account_code} {l.account_name}</td>
                <td className="p-3 text-right">{parseFloat(l.debit) > 0 ? fmtMoney(l.debit) : ''}</td>
                <td className="p-3 text-right">{parseFloat(l.credit) > 0 ? fmtMoney(l.credit) : ''}</td>
                <td className="p-3">{l.memo ?? ''}</td>
              </tr>
            ))}
            <tr className="font-semibold bg-muted/20">
              <td colSpan={2} className="p-3 text-right">Totals</td>
              <td className="p-3 text-right">{totalD.toFixed(2)}</td>
              <td className="p-3 text-right">{totalC.toFixed(2)}</td>
              <td></td>
            </tr>
          </tbody>
        </table>
      </CardContent></Card>

      {err && <p className="text-sm text-destructive">{err}</p>}
      {data.entry.status === 'posted' && (
        <Button variant="destructive" disabled={busy} onClick={voidIt}>Void this entry</Button>
      )}
    </div>
  );
}
