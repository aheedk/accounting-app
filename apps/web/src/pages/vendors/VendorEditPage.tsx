import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { Label } from '@/components/ui/label';
import { DateInput } from '@/components/ui/date-input';
import { Card, CardContent } from '@/components/ui/card';
import { parseMoneyInput } from '@/lib/money';
import { cleanPhoneInput, settlePhoneInput } from '@/lib/phone';
import { AppSelect } from '../../components/ui/select';
import { useAddAccount } from '@/components/addNew/useAddAccount';

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

type Account = { id: string; code: string; name: string; account_type: string };

type VendorRecord = {
  id: string;
  company_name: string | null;
  name: string;
  title: string | null;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  suffix: string | null;
  email: string | null;
  phone: string | null;
  email_cc: string | null;
  email_bcc: string | null;
  mobile: string | null;
  fax: string | null;
  other_phone: string | null;
  website: string | null;
  name_on_checks: string | null;
  notes: string | null;
  tax_id_last_four: string | null;
  tax_id_type: 'EIN' | 'SSN' | null;
  is_1099: boolean;
  default_terms_days: number;
  account_number: string | null;
  default_expense_account_id: string | null;
  opening_balance: string | null;
  opening_balance_as_of: string | null;
  billing_address: Partial<Address> | null;
};

type FormState = {
  company_name: string;
  name: string;
  title: string;
  first_name: string;
  middle_name: string;
  last_name: string;
  suffix: string;
  email: string;
  phone: string;
  email_cc: string;
  email_bcc: string;
  mobile: string;
  fax: string;
  other_phone: string;
  website: string;
  name_on_checks: string;
  notes: string;
  tax_id: string;
  tax_id_type: 'EIN' | 'SSN';
  is_1099: boolean;
  default_terms_days: number;
  account_number: string;
  default_expense_account_id: string;
  opening_balance: string;
  opening_balance_as_of: string;
};

function toFormState(v: VendorRecord): FormState {
  return {
    company_name: v.company_name ?? '',
    name: v.name,
    title: v.title ?? '',
    first_name: v.first_name ?? '',
    middle_name: v.middle_name ?? '',
    last_name: v.last_name ?? '',
    suffix: v.suffix ?? '',
    email: v.email ?? '',
    phone: v.phone ?? '',
    email_cc: v.email_cc ?? '',
    email_bcc: v.email_bcc ?? '',
    mobile: v.mobile ?? '',
    fax: v.fax ?? '',
    other_phone: v.other_phone ?? '',
    website: v.website ?? '',
    name_on_checks: v.name_on_checks ?? '',
    notes: v.notes ?? '',
    // Tax ID itself isn't returned by the read endpoint (only its last four) — left blank;
    // re-entering it is the only way to change it, same as the tax-id-reveal gate everywhere else.
    tax_id: '',
    tax_id_type: v.tax_id_type ?? 'EIN',
    is_1099: v.is_1099,
    default_terms_days: v.default_terms_days,
    account_number: v.account_number ?? '',
    default_expense_account_id: v.default_expense_account_id ?? '',
    opening_balance: v.opening_balance ?? '',
    opening_balance_as_of: v.opening_balance_as_of ?? '',
  };
}

export default function VendorEditPage() {
  const { id } = useParams<{ id: string }>();
  const [bizId] = useActiveBusinessId();
  const nav = useNavigate();

  const [form, setForm] = useState<FormState | null>(null);
  const [billing, setBilling] = useState<Address>(emptyAddress());
  const [accounts, setAccounts] = useState<Account[]>([]);
  const addAccount = useAddAccount(accounts, account => setAccounts(prev => [...prev, account]));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (bizId) api.get(`/businesses/${bizId}/coa`).then(r => setAccounts(r.data.accounts)); }, [bizId]);
  useEffect(() => {
    if (!bizId || !id) return;
    api.get(`/businesses/${bizId}/vendors/${id}`).then(r => {
      const v: VendorRecord = r.data;
      setForm(toFormState(v));
      setBilling({ ...emptyAddress(), ...(v.billing_address ?? {}) });
    });
  }, [bizId, id]);
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
    e.preventDefault();
    if (!form || !id) return;
    setErr(null); setBusy(true);
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
        is_1099: form.is_1099,
        default_terms_days: form.default_terms_days,
        account_number: form.account_number || null,
        default_expense_account_id: form.default_expense_account_id || null,
        opening_balance: form.opening_balance ? parseMoneyInput(form.opening_balance) : null,
        opening_balance_as_of: form.opening_balance ? form.opening_balance_as_of : null,
      };
      // Only touch tax_id if the user actually typed a new one — it's never pre-filled.
      if (form.tax_id) {
        body['tax_id'] = form.tax_id;
        body['tax_id_type'] = form.tax_id_type;
      }
      await api.patch(`/businesses/${bizId}/vendors/${id}`, body);
      nav(`/ap/vendors/${id}`);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
      setErr(msg ?? 'Failed');
    } finally { setBusy(false); }
  }

  if (!bizId || !id) return <div>Pick a business.</div>;
  if (!form) return <div>Loading…</div>;
  return (
    <form className="space-y-4 max-w-4xl" onSubmit={submit}>
      <h1 className="text-2xl font-semibold">Edit Vendor</h1>

      <Section title="Name and contact" defaultOpen>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Company name"><Input value={form.company_name} onChange={e => setForm(f => f && ({ ...f, company_name: e.target.value }))} /></Field>
          <Field label="Vendor display name" required>
            <Input value={form.name} onChange={e => setForm(f => f && ({ ...f, name: e.target.value }))} required />
          </Field>
        </div>
        <div className="grid grid-cols-5 gap-3">
          <Field label="Title"><Input value={form.title} onChange={e => setForm(f => f && ({ ...f, title: e.target.value }))} /></Field>
          <Field label="First name"><Input value={form.first_name} onChange={e => setForm(f => f && ({ ...f, first_name: e.target.value }))} /></Field>
          <Field label="Middle name"><Input value={form.middle_name} onChange={e => setForm(f => f && ({ ...f, middle_name: e.target.value }))} /></Field>
          <Field label="Last name"><Input value={form.last_name} onChange={e => setForm(f => f && ({ ...f, last_name: e.target.value }))} /></Field>
          <Field label="Suffix"><Input value={form.suffix} onChange={e => setForm(f => f && ({ ...f, suffix: e.target.value }))} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Email"><Input type="email" value={form.email} onChange={e => setForm(f => f && ({ ...f, email: e.target.value }))} /></Field>
          <Field label="Phone number">
            <Input
              value={form.phone}
              onChange={e => setForm(f => f && ({ ...f, phone: cleanPhoneInput(e.target.value) }))}
              onBlur={e => setForm(f => f && ({ ...f, phone: settlePhoneInput(e.target.value) }))}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Cc"><Input value={form.email_cc} onChange={e => setForm(f => f && ({ ...f, email_cc: e.target.value }))} /></Field>
          <Field label="Bcc"><Input value={form.email_bcc} onChange={e => setForm(f => f && ({ ...f, email_bcc: e.target.value }))} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Mobile number">
            <Input
              value={form.mobile}
              onChange={e => setForm(f => f && ({ ...f, mobile: cleanPhoneInput(e.target.value) }))}
              onBlur={e => setForm(f => f && ({ ...f, mobile: settlePhoneInput(e.target.value) }))}
            />
          </Field>
          <Field label="Fax">
            <Input
              value={form.fax}
              onChange={e => setForm(f => f && ({ ...f, fax: cleanPhoneInput(e.target.value) }))}
              onBlur={e => setForm(f => f && ({ ...f, fax: settlePhoneInput(e.target.value) }))}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Other">
            <Input
              value={form.other_phone}
              onChange={e => setForm(f => f && ({ ...f, other_phone: cleanPhoneInput(e.target.value) }))}
              onBlur={e => setForm(f => f && ({ ...f, other_phone: settlePhoneInput(e.target.value) }))}
            />
          </Field>
          <Field label="Website"><Input value={form.website} onChange={e => setForm(f => f && ({ ...f, website: e.target.value }))} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name to print on checks"><Input value={form.name_on_checks} onChange={e => setForm(f => f && ({ ...f, name_on_checks: e.target.value }))} /></Field>
        </div>
      </Section>

      <Section title="Address">
        <AddressFields value={billing} onChange={setBilling} />
      </Section>

      <Section title="Notes and attachments">
        <Field label="Notes">
          <textarea
            value={form.notes}
            onChange={e => setForm(f => f && ({ ...f, notes: e.target.value }))}
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
              <Input value={form.tax_id} onChange={e => setForm(f => f && ({ ...f, tax_id: e.target.value }))} placeholder="Leave blank to keep the number on file" />
            </Field>
            <Field label="ID type">
              <AppSelect className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.tax_id_type} onChange={e => setForm(f => f && ({ ...f, tax_id_type: e.target.value as 'EIN' | 'SSN' }))}>
                <option value="EIN">Business ID No. (EIN)</option>
                <option value="SSN">Social Security No. (SSN)</option>
              </AppSelect>
            </Field>
          </div>
          <label className="flex items-center gap-2 pt-3 text-sm">
            <input type="checkbox" className="h-4 w-4 rounded border" checked={form.is_1099} onChange={e => setForm(f => f && ({ ...f, is_1099: e.target.checked }))} />
            Track payments for 1099
          </label>
        </div>
        <div className="pt-3">
          <div className="text-sm font-medium pb-2">Payments</div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Terms">
              <AppSelect className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.default_terms_days} onChange={e => setForm(f => f && ({ ...f, default_terms_days: Number(e.target.value) }))}>
                {TERMS_OPTIONS.map(t => <option key={t.days} value={t.days}>{t.label}</option>)}
              </AppSelect>
            </Field>
            <Field label="Account no.">
              <Input value={form.account_number} onChange={e => setForm(f => f && ({ ...f, account_number: e.target.value }))} />
            </Field>
          </div>
        </div>
        <div className="pt-3">
          <div className="text-sm font-medium pb-2">Accounting</div>
          <Field label="Default expense category">
            <AppSelect className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.default_expense_account_id} onChange={e => setForm(f => f && ({ ...f, default_expense_account_id: e.target.value }))} onAddNew={() => addAccount.open({ onPick: idPicked => setForm(f => f && ({ ...f, default_expense_account_id: idPicked })) })} addNewLabel="Add new account">
              <option value="">Choose account</option>
              {expenseAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </AppSelect>
          </Field>
        </div>
        <div className="pt-3">
          <div className="text-sm font-medium pb-2">Opening balance</div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Opening balance">
              <MoneyInput allowNegative value={form.opening_balance} onChange={e => setForm(f => f && ({ ...f, opening_balance: e.target.value }))} />
            </Field>
            <Field label="As of">
              <DateInput value={form.opening_balance_as_of} onChange={e => setForm(f => f && ({ ...f, opening_balance_as_of: e.target.value }))} />
            </Field>
          </div>
        </div>
      </Section>

      {err && <p className="text-sm text-destructive">{err}</p>}
      <div className="flex gap-2 sticky -bottom-4 z-10 lg:-bottom-6 bg-background py-3 border-t">
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        <Button type="button" variant="outline" onClick={() => nav(`/ap/vendors/${id}`)}>Cancel</Button>
      </div>
      {addAccount.drawer}
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
