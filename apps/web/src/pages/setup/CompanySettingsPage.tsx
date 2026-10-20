import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { useEffectiveRole } from '@/lib/roleAccess';
import { pickErr } from '@/lib/apiErrors';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AppSelect } from '../../components/ui/select';
import { LoadingIndicator } from '@/components/ui/LoadingIndicator';

// A client's own defaults, like QuickBooks' Account and settings -> Sales and
// Expenses. Spec: docs/specs/2026-10-20-company-settings-design.md.

type Settings = {
  invoice_number_prefix: string;
  invoice_next_number: string | null;
  default_invoice_terms_days: number;
  default_bill_terms_days: number;
  default_sales_tax_code_id: string | null;
  default_expense_payment_method: string;
};

type FormState = {
  invoice_number_prefix: string;
  invoice_next_number: string;
  default_invoice_terms_days: number;
  default_bill_terms_days: number;
  default_sales_tax_code_id: string;
  default_expense_payment_method: string;
};

type TaxCode = { id: string; code: string; name: string; current_rate: string | null; is_active: boolean };

const TERMS: Array<{ days: number; label: string }> = [
  { days: 0, label: 'Due on receipt' },
  { days: 15, label: 'Net 15' },
  { days: 30, label: 'Net 30' },
  { days: 45, label: 'Net 45' },
  { days: 60, label: 'Net 60' },
  { days: 90, label: 'Net 90' },
];

// The same six the Expense form offers.
const PAYMENT_METHODS: Array<{ value: string; label: string }> = [
  { value: 'cash', label: 'Cash' },
  { value: 'check', label: 'Check' },
  { value: 'credit_card', label: 'Credit Card' },
  { value: 'debit_card', label: 'Debit Card' },
  { value: 'ach', label: 'ACH/EFT' },
  { value: 'other', label: 'Other' },
];

function toForm(s: Settings): FormState {
  return {
    invoice_number_prefix: s.invoice_number_prefix,
    invoice_next_number: s.invoice_next_number ?? '',
    default_invoice_terms_days: s.default_invoice_terms_days,
    default_bill_terms_days: s.default_bill_terms_days,
    default_sales_tax_code_id: s.default_sales_tax_code_id ?? '',
    default_expense_payment_method: s.default_expense_payment_method,
  };
}

/** Terms that are not in the list (set on an older company) still show. */
function termsOptions(selected: number) {
  const listed = TERMS.some(t => t.days === selected) ? TERMS : [...TERMS, { days: selected, label: `Net ${selected}` }];
  return listed.map(t => <option key={t.days} value={String(t.days)}>{t.label}</option>);
}

export default function CompanySettingsPage() {
  const [bizId] = useActiveBusinessId();
  const canEdit = useEffectiveRole() === 'firm_admin';
  const [saved, setSaved] = useState<Settings | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [taxCodes, setTaxCodes] = useState<TaxCode[]>([]);
  const [nextNumber, setNextNumber] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  function loadNextNumber() {
    if (!bizId) return;
    api.get<{ next_number: string }>(`/businesses/${bizId}/invoices/next-number`)
      .then(r => setNextNumber(r.data.next_number))
      .catch(() => setNextNumber(null));
  }

  useEffect(() => {
    if (!bizId) return;
    let cancelled = false;
    setErr(null);
    Promise.all([
      api.get<Settings>(`/businesses/${bizId}`),
      api.get<{ tax_codes?: TaxCode[] }>(`/businesses/${bizId}/tax-codes`).then(r => r.data.tax_codes ?? []).catch(() => []),
    ]).then(([biz, codes]) => {
      if (cancelled) return;
      setSaved(biz.data);
      setForm(toForm(biz.data));
      setTaxCodes(codes);
    }).catch((e: unknown) => { if (!cancelled) setErr(pickErr(e)); });
    loadNextNumber();
    return () => { cancelled = true; };
    // loadNextNumber only reads bizId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bizId]);

  const dirty = useMemo(
    () => !!saved && !!form && JSON.stringify(form) !== JSON.stringify(toForm(saved)),
    [saved, form],
  );

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setOk(null);
    setForm(f => (f ? { ...f, [key]: value } : f));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!bizId || !form || !canEdit) return;
    const startAt = form.invoice_next_number.trim();
    if (startAt !== '' && !/^[1-9][0-9]{0,8}$/.test(startAt)) {
      setErr('Start invoice numbers at a whole number from 1 to 999999999.');
      return;
    }
    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      const r = await api.patch<Settings>(`/businesses/${bizId}`, {
        invoice_number_prefix: form.invoice_number_prefix.trim(),
        invoice_next_number: startAt === '' ? null : Number(startAt),
        default_invoice_terms_days: form.default_invoice_terms_days,
        default_bill_terms_days: form.default_bill_terms_days,
        default_sales_tax_code_id: form.default_sales_tax_code_id || null,
        default_expense_payment_method: form.default_expense_payment_method,
      });
      setSaved(r.data);
      setForm(toForm(r.data));
      setOk('Saved');
      loadNextNumber();
    } catch (e: unknown) {
      setErr(pickErr(e));
    } finally {
      setBusy(false);
    }
  }

  if (!bizId) return <div>Pick a business.</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Company Settings</h1>
        <p className="text-sm text-muted-foreground">
          This company's invoice numbers and the defaults new invoices, bills and expenses start from.
        </p>
      </div>

      {!canEdit && (
        <Card className="border-dashed">
          <CardContent className="py-3 text-sm text-muted-foreground">
            View only. Ask a firm admin to change company settings.
          </CardContent>
        </Card>
      )}

      {!form ? (
        err ? <p className="text-sm text-destructive">{err}</p> : <LoadingIndicator />
      ) : (
        <form onSubmit={save} className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Sales</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="invoice_number_prefix">Invoice number prefix</Label>
                  <Input
                    id="invoice_number_prefix"
                    value={form.invoice_number_prefix}
                    maxLength={10}
                    placeholder="None, e.g. INV-"
                    onChange={e => update('invoice_number_prefix', e.target.value.replace(/[^A-Za-z0-9-]/g, ''))}
                    disabled={!canEdit}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="invoice_next_number">Start invoice numbers at</Label>
                  <Input
                    id="invoice_next_number"
                    inputMode="numeric"
                    value={form.invoice_next_number}
                    placeholder="1001"
                    onChange={e => update('invoice_next_number', e.target.value.replace(/[^0-9]/g, ''))}
                    disabled={!canEdit}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {nextNumber && !dirty ? <>The next invoice will be <span className="font-mono text-foreground">{nextNumber}</span>. </> : null}
                Numbers carry on from the highest one with this prefix, and never go below the start number.
                Recurring invoices, sales orders and customer purchase orders are numbered the same way.
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="invoice_terms">Default terms for invoices</Label>
                  <AppSelect
                    id="invoice_terms"
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                    value={String(form.default_invoice_terms_days)}
                    onChange={e => update('default_invoice_terms_days', Number(e.target.value))}
                    disabled={!canEdit}
                  >
                    {termsOptions(form.default_invoice_terms_days)}
                  </AppSelect>
                  <p className="text-xs text-muted-foreground">For a new invoice, until a customer with terms of its own is picked, and for new customers.</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sales_tax">Default sales tax</Label>
                  <AppSelect
                    id="sales_tax"
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                    value={form.default_sales_tax_code_id}
                    onChange={e => update('default_sales_tax_code_id', e.target.value)}
                    disabled={!canEdit}
                  >
                    <option value="">No tax</option>
                    {taxCodes.filter(tc => tc.is_active || tc.id === form.default_sales_tax_code_id).map(tc => (
                      <option key={tc.id} value={tc.id}>
                        {tc.code}{tc.current_rate ? ` (${(Number(tc.current_rate) * 100).toFixed(2)}%)` : ''}
                      </option>
                    ))}
                  </AppSelect>
                  <p className="text-xs text-muted-foreground">The tax a new invoice starts with. Tax codes are under Setup → Tax Codes.</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Expenses</CardTitle></CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="bill_terms">Default terms for bills</Label>
                  <AppSelect
                    id="bill_terms"
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                    value={String(form.default_bill_terms_days)}
                    onChange={e => update('default_bill_terms_days', Number(e.target.value))}
                    disabled={!canEdit}
                  >
                    {termsOptions(form.default_bill_terms_days)}
                  </AppSelect>
                  <p className="text-xs text-muted-foreground">For a new bill, until a vendor with terms of its own is picked, and for new vendors.</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="payment_method">Default payment method</Label>
                  <AppSelect
                    id="payment_method"
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                    value={form.default_expense_payment_method}
                    onChange={e => update('default_expense_payment_method', e.target.value)}
                    disabled={!canEdit}
                  >
                    {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </AppSelect>
                  <p className="text-xs text-muted-foreground">What a new expense is paid with.</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {err && <p className="text-sm text-destructive">{err}</p>}
          {ok && <p className="text-sm text-emerald-600">{ok}</p>}

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={!canEdit || busy || !dirty}>
              {busy ? 'Saving…' : 'Save changes'}
            </Button>
            {canEdit && dirty && (
              <Button type="button" variant="ghost" onClick={() => saved && setForm(toForm(saved))} disabled={busy}>
                Reset
              </Button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
