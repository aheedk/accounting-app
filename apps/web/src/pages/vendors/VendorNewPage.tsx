import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DateInput } from '@/components/ui/date-input';
import { Card, CardContent } from '@/components/ui/card';
import { parseMoneyInput } from '@/lib/money';

type Address = {
  line1: string;
  line2: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
};

const emptyAddress = (): Address => ({ line1: '', line2: '', city: '', state: '', postal_code: '', country: '' });

const TERMS_OPTIONS: { label: string; days: number }[] = [
  { label: 'Due on receipt', days: 0 },
  { label: 'Net 15', days: 15 },
  { label: 'Net 30', days: 30 },
  { label: 'Net 45', days: 45 },
  { label: 'Net 60', days: 60 },
  { label: 'Net 90', days: 90 },
];

type Account = { id: string; name: string; account_type: string };

export default function VendorNewPage() {
  const [bizId] = useActiveBusinessId();
  const nav = useNavigate();
  const today = new Date().toISOString().slice(0, 10);

  const [form, setForm] = useState({
    company_name: '',
    name: '',
    title: '',
    first_name: '',
    middle_name: '',
    last_name: '',
    suffix: '',
    email: '',
    phone: '',
    email_cc: '',
    email_bcc: '',
    mobile: '',
    fax: '',
    other_phone: '',
    website: '',
    name_on_checks: '',
    notes: '',
    tax_id: '',
    tax_id_type: 'EIN' as 'EIN' | 'SSN',
    is_1099: false,
    default_terms_days: 30,
    account_number: '',
    default_expense_account_id: '',
    opening_balance: '',
    opening_balance_as_of: today,
  });
  const [billing, setBilling] = useState<Address>(emptyAddress());
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (bizId) api.get(`/businesses/${bizId}/coa`).then(r => setAccounts(r.data.accounts)); }, [bizId]);
  const expenseAccounts = accounts.filter(a => a.account_type === 'expense');

  function nonEmpty<T extends Record<string, string>>(o: T): Partial<T> | null {
    const out: Partial<T> = {};
    let any = false;
    for (const k of Object.keys(o) as (keyof T)[]) {
      const v = o[k];
      if (typeof v === 'string' && v.trim() !== '') { out[k] = v; any = true; }
    }
    return any ? out : null;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(null); setBusy(true);
    try {
      const body: Record<string, unknown> = {
        name: form.name,
        company_name: form.company_name || null,
        title: form.title || null,
        first_name: form.first_name || null,
        middle_name: form.middle_name || null,
        last_name: form.last_name || null,
        suffix: form.suffix || null,
        email: form.email || null,
        email_cc: form.email_cc || null,
        email_bcc: form.email_bcc || null,
        phone: form.phone || null,
        mobile: form.mobile || null,
        fax: form.fax || null,
        other_phone: form.other_phone || null,
        website: form.website || null,
        name_on_checks: form.name_on_checks || null,
        billing_address: nonEmpty(billing),
        notes: form.notes || null,
        tax_id: form.tax_id || null,
        tax_id_type: form.tax_id ? form.tax_id_type : null,
        is_1099: form.is_1099,
        default_terms_days: form.default_terms_days,
        account_number: form.account_number || null,
        default_expense_account_id: form.default_expense_account_id || null,
        opening_balance: form.opening_balance ? parseMoneyInput(form.opening_balance) : null,
        opening_balance_as_of: form.opening_balance ? form.opening_balance_as_of : null,
      };
      const r = await api.post(`/businesses/${bizId}/vendors`, body);
      nav(`/ap/vendors/${r.data.id}`);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
      setErr(msg ?? 'Failed');
    } finally { setBusy(false); }
  }

  if (!bizId) return <div>Pick a business.</div>;
  return (
    <form className="space-y-4 max-w-4xl" onSubmit={submit}>
      <h1 className="text-2xl font-semibold">New Vendor</h1>

      <Section title="Name and contact" defaultOpen>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Company name"><Input value={form.company_name} onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))} /></Field>
          <Field label="Vendor display name" required>
            <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
          </Field>
        </div>
        <div className="grid grid-cols-5 gap-3">
          <Field label="Title"><Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} /></Field>
          <Field label="First name"><Input value={form.first_name} onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))} /></Field>
          <Field label="Middle name"><Input value={form.middle_name} onChange={e => setForm(f => ({ ...f, middle_name: e.target.value }))} /></Field>
          <Field label="Last name"><Input value={form.last_name} onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))} /></Field>
          <Field label="Suffix"><Input value={form.suffix} onChange={e => setForm(f => ({ ...f, suffix: e.target.value }))} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Email"><Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></Field>
          <Field label="Phone number"><Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Cc"><Input value={form.email_cc} onChange={e => setForm(f => ({ ...f, email_cc: e.target.value }))} /></Field>
          <Field label="Bcc"><Input value={form.email_bcc} onChange={e => setForm(f => ({ ...f, email_bcc: e.target.value }))} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Mobile number"><Input value={form.mobile} onChange={e => setForm(f => ({ ...f, mobile: e.target.value }))} /></Field>
          <Field label="Fax"><Input value={form.fax} onChange={e => setForm(f => ({ ...f, fax: e.target.value }))} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Other"><Input value={form.other_phone} onChange={e => setForm(f => ({ ...f, other_phone: e.target.value }))} /></Field>
          <Field label="Website"><Input value={form.website} onChange={e => setForm(f => ({ ...f, website: e.target.value }))} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name to print on checks"><Input value={form.name_on_checks} onChange={e => setForm(f => ({ ...f, name_on_checks: e.target.value }))} /></Field>
        </div>
      </Section>

      <Section title="Address">
        <AddressFields value={billing} onChange={setBilling} />
      </Section>

      <Section title="Notes and attachments">
        <Field label="Notes">
          <textarea
            value={form.notes}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            rows={4}
            className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
        </Field>
        <div className="text-xs text-muted-foreground">Attachments coming soon.</div>
      </Section>

      <Section title="Additional info">
        <div>
          <div className="text-sm font-medium pb-2">Sales tax</div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Business ID No. / Social Security No.">
              <Input value={form.tax_id} onChange={e => setForm(f => ({ ...f, tax_id: e.target.value }))} placeholder="e.g. 12-3456789" />
            </Field>
            <Field label="ID type">
              <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.tax_id_type} onChange={e => setForm(f => ({ ...f, tax_id_type: e.target.value as 'EIN' | 'SSN' }))}>
                <option value="EIN">Business ID No. (EIN)</option>
                <option value="SSN">Social Security No. (SSN)</option>
              </select>
            </Field>
          </div>
          <label className="flex items-center gap-2 pt-3 text-sm">
            <input type="checkbox" className="h-4 w-4 rounded border" checked={form.is_1099} onChange={e => setForm(f => ({ ...f, is_1099: e.target.checked }))} />
            Track payments for 1099
          </label>
        </div>
        <div className="pt-3">
          <div className="text-sm font-medium pb-2">Payments</div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Terms">
              <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.default_terms_days} onChange={e => setForm(f => ({ ...f, default_terms_days: Number(e.target.value) }))}>
                {TERMS_OPTIONS.map(t => <option key={t.days} value={t.days}>{t.label}</option>)}
              </select>
            </Field>
            <Field label="Account no.">
              <Input value={form.account_number} onChange={e => setForm(f => ({ ...f, account_number: e.target.value }))} />
            </Field>
          </div>
        </div>
        <div className="pt-3">
          <div className="text-sm font-medium pb-2">Accounting</div>
          <Field label="Default expense category">
            <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.default_expense_account_id} onChange={e => setForm(f => ({ ...f, default_expense_account_id: e.target.value }))}>
              <option value="">Choose account</option>
              {expenseAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
        </div>
        <div className="pt-3">
          <div className="text-sm font-medium pb-2">Opening balance</div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Opening balance">
              <Input type="number" step="0.01" value={form.opening_balance} onChange={e => setForm(f => ({ ...f, opening_balance: e.target.value }))} />
            </Field>
            <Field label="As of">
              <DateInput value={form.opening_balance_as_of} onChange={e => setForm(f => ({ ...f, opening_balance_as_of: e.target.value }))} />
            </Field>
          </div>
        </div>
      </Section>

      {err && <p className="text-sm text-destructive">{err}</p>}
      <div className="flex gap-2 sticky bottom-0 bg-background py-3 border-t">
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        <Button type="button" variant="outline" onClick={() => nav('/ap/vendors')}>Cancel</Button>
      </div>
    </form>
  );
}

function Section({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card>
      <button type="button" onClick={() => setOpen(o => !o)} className="flex w-full items-center justify-between px-6 py-4 text-left">
        <span className="text-base font-semibold">{title}</span>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>
      {open && <CardContent className="space-y-3 pt-0">{children}</CardContent>}
    </Card>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}{required ? ' *' : ''}</Label>
      {children}
    </div>
  );
}

function AddressFields({ value, onChange }: { value: Address; onChange: (v: Address) => void }) {
  const set = (patch: Partial<Address>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Street address 1"><Input value={value.line1} onChange={e => set({ line1: e.target.value })} /></Field>
        <Field label="Street address 2"><Input value={value.line2} onChange={e => set({ line2: e.target.value })} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="City"><Input value={value.city} onChange={e => set({ city: e.target.value })} /></Field>
        <Field label="State"><Input value={value.state} onChange={e => set({ state: e.target.value })} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="ZIP code"><Input value={value.postal_code} onChange={e => set({ postal_code: e.target.value })} /></Field>
        <Field label="Country"><Input value={value.country} onChange={e => set({ country: e.target.value })} /></Field>
      </div>
    </div>
  );
}
