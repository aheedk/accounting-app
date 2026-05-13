import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AccountSelect } from '@/components/ui/AccountSelect';
import { fmtMoney, parseMoneyInput } from '@/lib/money';

type Account = { id: string; code: string; name: string; account_type: string };
type Line = { account_id: string; debit: string; credit: string; memo: string };

const blank = (): Line => ({ account_id: '', debit: '0.00', credit: '0.00', memo: '' });

function pickErr(e: unknown): string {
  return (e as { response?: { data?: { error?: { message?: string } } } } | undefined)
    ?.response?.data?.error?.message ?? 'Failed';
}

export default function JournalNewPage() {
  const [bizId] = useActiveBusinessId();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [memo, setMemo] = useState('');
  const [reference, setReference] = useState('');
  const [lines, setLines] = useState<Line[]>([blank(), blank()]);
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
      const body = {
        entry_date: date,
        memo: memo || null,
        reference: reference || null,
        lines: lines.map(l => ({
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
      <h1 className="text-2xl font-semibold">New Journal Entry</h1>

      <Card><CardHeader><CardTitle>Header</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-3 gap-3">
          <div><Label>Date</Label><Input type="date" value={date} onChange={e => setDate(e.target.value)} required /></div>
          <div><Label>Reference</Label><Input value={reference} onChange={e => setReference(e.target.value)} placeholder="e.g. INV-1042 or check #" /></div>
          <div><Label>Memo</Label><Input value={memo} onChange={e => setMemo(e.target.value)} placeholder="Description for this entry" /></div>
        </CardContent>
      </Card>

      <Card><CardHeader><CardTitle>Lines</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-12 gap-2 px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <div className="col-span-4">Account</div>
            <div className="col-span-2 text-right">Debit</div>
            <div className="col-span-2 text-right">Credit</div>
            <div className="col-span-3">Memo</div>
            <div className="col-span-1" />
          </div>
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-start">
              <div className="col-span-4">
                <Label htmlFor={`line-${i}-account`} className="sr-only">Account</Label>
                <AccountSelect
                  id={`line-${i}-account`}
                  accounts={accounts}
                  value={l.account_id}
                  onChange={(id) => update(i, { account_id: id })}
                  required
                  placeholder="Search account…"
                />
              </div>
              <div className="col-span-2">
                <Label htmlFor={`line-${i}-debit`} className="sr-only">Debit</Label>
                <Input
                  id={`line-${i}-debit`}
                  type="number"
                  step="0.0001"
                  min="0"
                  inputMode="decimal"
                  value={l.debit}
                  onChange={e => update(i, { debit: e.target.value, credit: '0.00' })}
                  placeholder="0.00"
                  className="text-right font-mono"
                />
              </div>
              <div className="col-span-2">
                <Label htmlFor={`line-${i}-credit`} className="sr-only">Credit</Label>
                <Input
                  id={`line-${i}-credit`}
                  type="number"
                  step="0.0001"
                  min="0"
                  inputMode="decimal"
                  value={l.credit}
                  onChange={e => update(i, { credit: e.target.value, debit: '0.00' })}
                  placeholder="0.00"
                  className="text-right font-mono"
                />
              </div>
              <div className="col-span-3">
                <Label htmlFor={`line-${i}-memo`} className="sr-only">Memo</Label>
                <Input
                  id={`line-${i}-memo`}
                  value={l.memo}
                  onChange={e => update(i, { memo: e.target.value })}
                  placeholder="Line description (optional)"
                />
              </div>
              <div className="col-span-1 flex items-center justify-end">
                <Button type="button" variant="ghost" onClick={() => setLines(ls => ls.filter((_, idx) => idx !== i))} disabled={lines.length <= 2} aria-label="Remove line">×</Button>
              </div>
            </div>
          ))}
          <Button type="button" variant="outline" onClick={() => setLines(ls => [...ls, blank()])}>Add line</Button>

          <div className="flex justify-end gap-8 pt-4 border-t font-mono">
            <div>Total Debit: {fmtMoney(totalD)}</div>
            <div>Total Credit: {fmtMoney(totalC)}</div>
            <div className={balanced ? 'text-green-600' : 'text-destructive'}>{balanced ? 'BALANCED' : 'UNBALANCED'}</div>
          </div>
        </CardContent>
      </Card>

      {err && <p className="text-sm text-destructive">{err}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={!balanced || busy}>{busy ? 'Posting…' : 'Post entry'}</Button>
        <Button type="button" variant="outline" onClick={() => nav('/journal')}>Cancel</Button>
      </div>
    </form>
  );
}
