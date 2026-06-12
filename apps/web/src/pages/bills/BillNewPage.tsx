import { useEffect, useMemo, useState } from 'react';
import { DateInput } from '@/components/ui/date-input';
import { useNavigate, useSearchParams } from 'react-router-dom';
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

type Line = { description: string; quantity: string; unit_price: string; expense_account_id: string };
type Address = { line1?: string; line2?: string; city?: string; state?: string; postal_code?: string; country?: string };
type Vendor = { id: string; name: string; default_terms_days: number; billing_address: Address | null };
type Account = { id: string; code: string; name: string; account_type: string; is_system: boolean; is_active: boolean };
const blank = (): Line => ({ description: '', quantity: '1', unit_price: '', expense_account_id: '' });

const TERMS_OPTIONS: { label: string; days: number }[] = [
  { label: 'Due on receipt', days: 0 },
  { label: 'Net 15', days: 15 },
  { label: 'Net 30', days: 30 },
  { label: 'Net 45', days: 45 },
  { label: 'Net 60', days: 60 },
  { label: 'Net 90', days: 90 },
];

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function fmtAddress(a: Address | null | undefined): string {
  if (!a) return '';
  const cityLine = [a.city, a.state, a.postal_code].filter(Boolean).join(', ');
  return [a.line1, a.line2, cityLine, a.country].filter(Boolean).join('\n');
}

export default function BillNewPage() {
  const [bizId] = useActiveBusinessId();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [expenseAccounts, setExpenseAccounts] = useState<Account[]>([]);
  const today = todayLocal();
  const [hdr, setHdr] = useState({
    vendor_id: params.get('vendor_id') ?? '',
    bill_number: '',
    bill_date: today,
    due_date: today,
    terms_days: 0,
    memo: '',
  });
  const [lines, setLines] = useState<Line[]>([blank(), blank()]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!bizId) return;
    api.get(`/businesses/${bizId}/vendors`).then(r => setVendors(r.data.vendors));
    api.get(`/businesses/${bizId}/coa`).then(r => setExpenseAccounts(r.data.accounts.filter((a: Account) => a.account_type === 'expense' && a.is_active)));
  }, [bizId]);

  const vendor = useMemo(() => vendors.find(v => v.id === hdr.vendor_id), [vendors, hdr.vendor_id]);

  // Picking a vendor adopts its default terms; changing terms or bill date recomputes the due date (QBO behavior).
  function pickVendor(vendor_id: string) {
    const v = vendors.find(x => x.id === vendor_id);
    const terms_days = v?.default_terms_days ?? 0;
    setHdr(h => ({ ...h, vendor_id, terms_days, due_date: addDays(h.bill_date, terms_days) }));
  }
  function pickTerms(terms_days: number) {
    setHdr(h => ({ ...h, terms_days, due_date: addDays(h.bill_date, terms_days) }));
  }
  function pickBillDate(bill_date: string) {
    setHdr(h => ({ ...h, bill_date, due_date: addDays(bill_date, h.terms_days) }));
  }

  function update(i: number, patch: Partial<Line>) { setLines(ls => ls.map((l, idx) => idx === i ? { ...l, ...patch } : l)); }
  const lineAmount = (l: Line) => (Number(l.quantity) || 0) * (Number(l.unit_price) || 0);
  const total = lines.reduce((s, l) => s + lineAmount(l), 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(null); setBusy(true);
    try {
      const used = lines.filter(l => l.description.trim() !== '' || l.expense_account_id !== '');
      const body = {
        vendor_id: hdr.vendor_id, bill_number: hdr.bill_number,
        bill_date: hdr.bill_date, due_date: hdr.due_date, memo: hdr.memo || null,
        terms: TERMS_OPTIONS.find(t => t.days === hdr.terms_days)?.label ?? null,
        lines: used.map(l => ({
          description: l.description, quantity: parseMoneyInput(l.quantity), unit_price: parseMoneyInput(l.unit_price),
          expense_account_id: l.expense_account_id,
        })),
      };
      const r = await api.post(`/businesses/${bizId}/bills`, body);
      nav(`/ap/bills/${r.data.bill.id}`);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
      setErr(msg ?? 'Failed');
    }
    finally { setBusy(false); }
  }

  if (!bizId) return <div>Pick a business.</div>;
  return (
    <form className="space-y-6" onSubmit={submit}>
      <div className="flex items-start justify-between">
        <h1 className="text-2xl font-semibold">Bill</h1>
        <div className="text-right">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Balance due</div>
          <div className="text-3xl font-semibold font-mono">{fmtMoney(String(total))}</div>
        </div>
      </div>

      <Card><CardContent className="grid grid-cols-1 gap-3 pt-6 md:grid-cols-4">
        <div>
          <Label className="text-xs text-muted-foreground">Vendor</Label>
          <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={hdr.vendor_id} onChange={e => pickVendor(e.target.value)} required>
            <option value="">Choose a vendor</option>{vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          <div className="mt-3">
            <Label className="text-xs text-muted-foreground">Mailing address</Label>
            <div className="min-h-[5rem] whitespace-pre-line rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              {fmtAddress(vendor?.billing_address) || '—'}
            </div>
          </div>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Terms</Label>
          <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={hdr.terms_days} onChange={e => pickTerms(Number(e.target.value))}>
            {TERMS_OPTIONS.map(t => <option key={t.days} value={t.days}>{t.label}</option>)}
          </select>
          <div className="mt-3">
            <Label className="text-xs text-muted-foreground">Bill no.</Label>
            <Input value={hdr.bill_number} onChange={e => setHdr(h => ({ ...h, bill_number: e.target.value }))} placeholder="Vendor's bill number" required />
          </div>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Bill date</Label>
          <DateInput value={hdr.bill_date} onChange={e => pickBillDate(e.target.value)} required />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Due date</Label>
          <DateInput value={hdr.due_date} onChange={e => setHdr(h => ({ ...h, due_date: e.target.value }))} required />
        </div>
      </CardContent></Card>

      <Card><CardContent className="p-0">
        <div className="border-b px-6 py-3 text-sm font-semibold">Category details</div>
        <table className="w-full text-sm">
          <thead className="border-b">
            <tr className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <th className="w-10 p-3 text-left">#</th>
              <th className="p-3 text-left">Category</th>
              <th className="p-3 text-left">Description</th>
              <th className="w-24 p-3 text-right">Qty</th>
              <th className="w-32 p-3 text-right">Rate</th>
              <th className="w-32 p-3 text-right">Amount</th>
              <th className="w-12 p-3"></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className="border-b">
                <td className="p-3 text-muted-foreground">{i + 1}</td>
                <td className="p-3">
                  <AccountSelect
                    id={`line-${i}-expense`}
                    accounts={expenseAccounts}
                    value={l.expense_account_id}
                    onChange={(id) => update(i, { expense_account_id: id })}
                    placeholder="Choose category…"
                  />
                </td>
                <td className="p-3">
                  <Input value={l.description} onChange={e => update(i, { description: e.target.value })} placeholder="What was billed" />
                </td>
                <td className="p-3">
                  <Input type="number" step="0.01" inputMode="decimal" value={l.quantity} onChange={e => update(i, { quantity: e.target.value })} className="text-right font-mono" />
                </td>
                <td className="p-3">
                  <Input type="number" step="0.01" inputMode="decimal" value={l.unit_price} onChange={e => update(i, { unit_price: e.target.value })} placeholder="0.00" className="text-right font-mono" />
                </td>
                <td className="p-3 text-right font-mono">{fmtMoney(String(lineAmount(l)))}</td>
                <td className="p-3">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setLines(ls => ls.filter((_, idx) => idx !== i))} disabled={lines.length <= 1} aria-label="Remove line">
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex items-center gap-2 px-6 py-3">
          <Button type="button" variant="outline" size="sm" onClick={() => setLines(ls => [...ls, blank()])}>Add lines</Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setLines([blank(), blank()])}>Clear all lines</Button>
          <div className="flex-1" />
          <div className="flex items-center gap-12 text-sm font-semibold">
            <span>Total</span>
            <span className="font-mono">{fmtMoney(String(total))}</span>
          </div>
        </div>
      </CardContent></Card>

      <div className="max-w-md">
        <Label className="text-xs text-muted-foreground">Memo</Label>
        <textarea
          value={hdr.memo}
          onChange={e => setHdr(h => ({ ...h, memo: e.target.value }))}
          rows={3}
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        />
      </div>

      {err && <p className="text-sm text-destructive">{err}</p>}
      <div className="flex items-center gap-2 sticky bottom-0 border-t bg-background py-3">
        <Button type="button" variant="outline" onClick={() => nav('/ap/bills')}>Cancel</Button>
        <div className="flex-1" />
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save draft'}</Button>
      </div>
    </form>
  );
}
