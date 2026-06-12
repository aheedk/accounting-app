import { useEffect, useState } from 'react';
import { DateInput } from '@/components/ui/date-input';
import { useNavigate } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { AccountSelect } from '@/components/ui/AccountSelect';
import { fmtMoney, parseMoneyInput } from '@/lib/money';
import { todayLocal } from '@/lib/dates';

type Account = { id: string; code: string; name: string; account_type: string };
type Line = { account_id: string; debit: string; credit: string; memo: string };

const blank = (): Line => ({ account_id: '', debit: '', credit: '', memo: '' });

function pickErr(e: unknown): string {
  return (e as { response?: { data?: { error?: { message?: string } } } } | undefined)
    ?.response?.data?.error?.message ?? 'Failed';
}

export default function JournalNewPage() {
  const [bizId] = useActiveBusinessId();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [date, setDate] = useState(todayLocal());
  const [memo, setMemo] = useState('');
  const [reference, setReference] = useState('');
  const [lines, setLines] = useState<Line[]>([blank(), blank(), blank(), blank()]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  useEffect(() => {
    if (!bizId) return;
    api.get(`/businesses/${bizId}/coa`).then(r => setAccounts(r.data.accounts));
  }, [bizId]);

  function update(i: number, patch: Partial<Line>) {
    setLines(ls => ls.map((l, idx) => idx === i ? { ...l, ...patch } : l));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(null); setBusy(true);
    try {
      const used = lines.filter(l => l.account_id !== '');
      const body = {
        entry_date: date,
        memo: memo || null,
        reference: reference || null,
        lines: used.map(l => ({
          account_id: l.account_id,
          debit: parseMoneyInput(l.debit || '0'),
          credit: parseMoneyInput(l.credit || '0'),
          memo: l.memo || null,
        })),
      };
      const r = await api.post(`/businesses/${bizId}/journal-entries`, body);
      nav(`/journal/${r.data.id}`);
    } catch (e: unknown) { setErr(pickErr(e)); }
    finally { setBusy(false); }
  }

  const totalD = lines.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0);
  const totalC = lines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
  const balanced = Math.abs(totalD - totalC) < 0.005 && totalD > 0;

  if (!bizId) return <div>Pick a business.</div>;

  return (
    <form className="space-y-6" onSubmit={submit}>
      <h1 className="text-2xl font-semibold">Journal Entry</h1>

      <Card><CardContent className="grid grid-cols-1 gap-3 pt-6 md:grid-cols-3">
        <div><Label className="text-xs text-muted-foreground">Journal date</Label><DateInput value={date} onChange={e => setDate(e.target.value)} required /></div>
        <div><Label className="text-xs text-muted-foreground">Journal no.</Label><Input value={reference} onChange={e => setReference(e.target.value)} placeholder="e.g. AJE-12" /></div>
        <div><Label className="text-xs text-muted-foreground">Memo</Label><Input value={memo} onChange={e => setMemo(e.target.value)} placeholder="Description for this entry" /></div>
      </CardContent></Card>

      <Card><CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="border-b">
            <tr className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <th className="w-10 p-3 text-left">#</th>
              <th className="p-3 text-left">Account</th>
              <th className="w-36 p-3 text-right">Debits</th>
              <th className="w-36 p-3 text-right">Credits</th>
              <th className="p-3 text-left">Description</th>
              <th className="w-12 p-3"></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className="border-b">
                <td className="p-3 text-muted-foreground">{i + 1}</td>
                <td className="p-3">
                  <AccountSelect
                    id={`line-${i}-account`}
                    accounts={accounts}
                    value={l.account_id}
                    onChange={(id) => update(i, { account_id: id })}
                    placeholder="Search account…"
                  />
                </td>
                <td className="p-3">
                  <Input
                    id={`line-${i}-debit`}
                    type="number" step="0.0001" min="0" inputMode="decimal"
                    value={l.debit}
                    onChange={e => update(i, { debit: e.target.value, credit: '' })}
                    placeholder="0.00"
                    className="text-right font-mono"
                  />
                </td>
                <td className="p-3">
                  <Input
                    id={`line-${i}-credit`}
                    type="number" step="0.0001" min="0" inputMode="decimal"
                    value={l.credit}
                    onChange={e => update(i, { credit: e.target.value, debit: '' })}
                    placeholder="0.00"
                    className="text-right font-mono"
                  />
                </td>
                <td className="p-3">
                  <Input
                    id={`line-${i}-memo`}
                    value={l.memo}
                    onChange={e => update(i, { memo: e.target.value })}
                    placeholder="Line description (optional)"
                  />
                </td>
                <td className="p-3">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setLines(ls => ls.filter((_, idx) => idx !== i))} disabled={lines.length <= 2} aria-label="Remove line">
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </td>
              </tr>
            ))}
            <tr className="bg-muted/30 font-semibold">
              <td className="p-3"></td>
              <td className="p-3 text-right">Total</td>
              <td className="p-3 text-right font-mono">{fmtMoney(totalD)}</td>
              <td className="p-3 text-right font-mono">{fmtMoney(totalC)}</td>
              <td className="p-3" colSpan={2}>
                <span className={balanced ? 'text-green-600' : 'text-destructive'}>{balanced ? 'Balanced' : 'Unbalanced'}</span>
              </td>
            </tr>
          </tbody>
        </table>
        <div className="flex items-center gap-2 px-6 py-3">
          <Button type="button" variant="outline" size="sm" onClick={() => setLines(ls => [...ls, blank()])}>Add lines</Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setLines([blank(), blank(), blank(), blank()])}>Clear all lines</Button>
        </div>
      </CardContent></Card>

      {err && <p className="text-sm text-destructive">{err}</p>}
      <div className="flex items-center gap-2 sticky bottom-0 border-t bg-background py-3">
        <Button type="button" variant="outline" onClick={() => nav('/journal')}>Cancel</Button>
        <div className="flex-1" />
        <Button type="submit" disabled={!balanced || busy}>{busy ? 'Posting…' : 'Post entry'}</Button>
      </div>
    </form>
  );
}
