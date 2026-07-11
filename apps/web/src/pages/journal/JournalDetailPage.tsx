import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DetailActivity, DetailField, DetailMetric, DetailPageHeader, baseDetailMenuActions } from '@/components/ui/detail-page';
import { fmtDateTime, fmtLongDate } from '@/lib/dates';
import { fmtMoney } from '@/lib/money';
import { pickErr } from '@/lib/apiErrors';

type JELine = {
  id: string;
  line_number: number;
  account_id: string;
  account_code: string;
  account_name: string;
  debit: string;
  credit: string;
  memo: string | null;
};
type JEData = {
  entry: {
    id: string;
    entry_date: string;
    status: string;
    memo: string | null;
    reference: string | null;
    source_type: string;
    source_id: string | null;
    reversed_entry_id: string | null;
    posted_at: string | null;
    voided_at: string | null;
    void_reason: string | null;
    created_at: string;
    updated_at: string;
  };
  lines: JELine[];
};


export default function JournalDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [bizId] = useActiveBusinessId();
  const [data, setData] = useState<JEData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  async function reload() {
    if (!bizId || !id) return;
    const r = await api.get<JEData>(`/businesses/${bizId}/journal-entries/${id}`);
    setData(r.data);
  }

  useEffect(() => { void reload(); }, [bizId, id]);

  async function voidIt() {
    const reason = window.prompt('Reason for voiding?');
    if (!reason) return;
    setBusy(true); setErr(null);
    try {
      await api.post(`/businesses/${bizId}/journal-entries/${id}/void`, { void_reason: reason });
      await reload();
    }
    catch (e: unknown) { setErr(pickErr(e)); }
    finally { setBusy(false); }
  }

  if (!data) return <div>Loading...</div>;
  const totalD = data.lines.reduce((s, l) => s + parseFloat(l.debit), 0);
  const totalC = data.lines.reduce((s, l) => s + parseFloat(l.credit), 0);
  const isBalanced = Math.abs(totalD - totalC) < 0.005;

  return (
    <div className="space-y-6">
      <DetailPageHeader
        eyebrow="Journal entry"
        title={data.entry.reference || `JE ${data.entry.id.slice(0, 8)}`}
        subtitle={fmtLongDate(data.entry.entry_date)}
        status={data.entry.status}
        totalLabel="Entry total"
        total={fmtMoney(totalD)}
        menuActions={[
          ...baseDetailMenuActions(),
          ...(data.entry.status === 'posted' ? [{ label: 'Void entry', icon: <Trash2 className="h-4 w-4" />, onSelect: voidIt, destructive: true, disabled: busy }] : []),
        ]}
      />

      <div className="grid gap-3 md:grid-cols-3">
        <DetailMetric label="Debit total" value={fmtMoney(totalD)} />
        <DetailMetric label="Credit total" value={fmtMoney(totalC)} />
        <DetailMetric label="Balance check" value={isBalanced ? 'Balanced' : 'Out of balance'} hint={data.entry.source_type.replace(/_/g, ' ')} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Entry details</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <DetailField label="Entry date" value={fmtLongDate(data.entry.entry_date)} />
            <DetailField label="Reference" value={data.entry.reference} />
            <DetailField label="Source" value={data.entry.source_type.replace(/_/g, ' ')} />
            <DetailField label="Source ID" value={data.entry.source_id ? data.entry.source_id.slice(0, 8) : null} />
            <DetailField label="Memo" className="sm:col-span-2" value={data.entry.memo} />
            <DetailField
              label="Reverses"
              value={data.entry.reversed_entry_id
                ? <Link className="font-mono text-primary hover:underline" to={`/journal/${data.entry.reversed_entry_id}`}>JE {data.entry.reversed_entry_id.slice(0, 8)}</Link>
                : null}
            />
            <DetailField label="Void reason" value={data.entry.void_reason} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Activity</CardTitle></CardHeader>
          <CardContent>
            <DetailActivity
              items={[
                { label: 'Created', value: fmtDateTime(data.entry.created_at) },
                { label: 'Last updated', value: fmtDateTime(data.entry.updated_at) },
                { label: 'Posted', value: data.entry.posted_at ? fmtDateTime(data.entry.posted_at) : null },
                { label: 'Voided', value: data.entry.voided_at ? fmtDateTime(data.entry.voided_at) : null },
              ]}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Lines</CardTitle></CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40">
              <tr>
                <th className="p-3 text-left">#</th>
                <th className="p-3 text-left">Account</th>
                <th className="p-3 text-right">Debit</th>
                <th className="p-3 text-right">Credit</th>
                <th className="p-3 text-left">Memo</th>
              </tr>
            </thead>
            <tbody>
              {data.lines.map(l => (
                <tr key={l.id} className="border-b last:border-b-0">
                  <td className="p-3">{l.line_number}</td>
                  <td className="p-3"><span className="font-mono">{l.account_code}</span> {l.account_name}</td>
                  <td className="p-3 text-right font-mono">{parseFloat(l.debit) > 0 ? fmtMoney(l.debit) : ''}</td>
                  <td className="p-3 text-right font-mono">{parseFloat(l.credit) > 0 ? fmtMoney(l.credit) : ''}</td>
                  <td className="p-3">{l.memo ?? ''}</td>
                </tr>
              ))}
              <tr className="border-t bg-muted/20 font-semibold">
                <td colSpan={2} className="p-3 text-right">Totals</td>
                <td className="p-3 text-right font-mono">{fmtMoney(totalD)}</td>
                <td className="p-3 text-right font-mono">{fmtMoney(totalC)}</td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </CardContent>
      </Card>

      {err && <p className="text-sm text-destructive">{err}</p>}
      <Button variant="outline" onClick={() => nav('/journal')}>Back to journal</Button>
    </div>
  );
}
