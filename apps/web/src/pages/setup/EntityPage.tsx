import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { useAuth } from '@/auth/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type BusinessAddress = {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
};

type Business = {
  id: string;
  firm_id: string;
  name: string;
  legal_name: string | null;
  tax_id: string | null;
  fiscal_year_start_month: number;
  address: BusinessAddress | null;
  created_at: string;
  updated_at: string;
};

type FormState = {
  name: string;
  legal_name: string;
  tax_id: string;
  fiscal_year_start_month: number;
  address_line1: string;
  address_line2: string;
  address_city: string;
  address_state: string;
  address_postal_code: string;
  address_country: string;
};

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function toFormState(b: Business): FormState {
  return {
    name: b.name,
    legal_name: b.legal_name ?? '',
    tax_id: b.tax_id ?? '',
    fiscal_year_start_month: b.fiscal_year_start_month,
    address_line1: b.address?.line1 ?? '',
    address_line2: b.address?.line2 ?? '',
    address_city: b.address?.city ?? '',
    address_state: b.address?.state ?? '',
    address_postal_code: b.address?.postal_code ?? '',
    address_country: b.address?.country ?? '',
  };
}

export default function EntityPage() {
  const [bizId] = useActiveBusinessId();
  const { user } = useAuth();
  const canEdit = user?.role === 'firm_admin';

  const [business, setBusiness] = useState<Business | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!bizId) return;
    let cancelled = false;
    setErr(null);
    setOk(null);
    api.get<Business>(`/businesses/${bizId}`)
      .then(r => {
        if (cancelled) return;
        setBusiness(r.data);
        setForm(toFormState(r.data));
      })
      .catch((e: unknown) => {
        const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)
          ?.response?.data?.error?.message;
        setErr(msg ?? 'Failed to load business');
      });
    return () => { cancelled = true; };
  }, [bizId]);

  const dirty = useMemo(() => {
    if (!business || !form) return false;
    return JSON.stringify(form) !== JSON.stringify(toFormState(business));
  }, [business, form]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!bizId || !form || !canEdit) return;
    setErr(null);
    setOk(null);
    setBusy(true);
    try {
      const addressProvided = Boolean(
        form.address_line1 || form.address_line2 || form.address_city ||
        form.address_state || form.address_postal_code || form.address_country,
      );
      const address: BusinessAddress | null = addressProvided
        ? {
            ...(form.address_line1 ? { line1: form.address_line1 } : {}),
            ...(form.address_line2 ? { line2: form.address_line2 } : {}),
            ...(form.address_city ? { city: form.address_city } : {}),
            ...(form.address_state ? { state: form.address_state } : {}),
            ...(form.address_postal_code ? { postal_code: form.address_postal_code } : {}),
            ...(form.address_country ? { country: form.address_country } : {}),
          }
        : null;

      const payload = {
        name: form.name,
        legal_name: form.legal_name || null,
        tax_id: form.tax_id || null,
        fiscal_year_start_month: form.fiscal_year_start_month,
        address,
      };
      const r = await api.patch<Business>(`/businesses/${bizId}`, payload);
      setBusiness(r.data);
      setForm(toFormState(r.data));
      setOk('Saved');
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)
        ?.response?.data?.error?.message;
      setErr(msg ?? 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(f => (f ? { ...f, [key]: value } : f));
  }

  if (!bizId) return <div>Pick a business.</div>;
  if (!business || !form) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">Entity</h1>
        {err && <p className="text-sm text-destructive">{err}</p>}
        {!err && <p className="text-sm text-muted-foreground">Loading…</p>}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Entity</h1>
        <p className="text-sm text-muted-foreground">
          Legal entity, addresses, fiscal year, and tax IDs.
        </p>
      </div>

      {!canEdit && (
        <Card className="border-dashed">
          <CardContent className="py-3 text-sm text-muted-foreground">
            View only. Ask a firm admin to edit entity details.
          </CardContent>
        </Card>
      )}

      <form onSubmit={save} className="space-y-6">
        <Card>
          <CardHeader><CardTitle>Business details</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="name">Display name</Label>
                <Input id="name" value={form.name}
                  onChange={e => updateField('name', e.target.value)}
                  disabled={!canEdit} required />
              </div>
              <div>
                <Label htmlFor="legal_name">Legal name</Label>
                <Input id="legal_name" value={form.legal_name}
                  onChange={e => updateField('legal_name', e.target.value)}
                  disabled={!canEdit} />
              </div>
              <div>
                <Label htmlFor="tax_id">Tax ID (EIN)</Label>
                <Input id="tax_id" value={form.tax_id}
                  onChange={e => updateField('tax_id', e.target.value)}
                  disabled={!canEdit} placeholder="12-3456789" />
              </div>
              <div>
                <Label htmlFor="fy_month">Fiscal year starts</Label>
                <select
                  id="fy_month"
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={form.fiscal_year_start_month}
                  onChange={e => updateField('fiscal_year_start_month', parseInt(e.target.value, 10))}
                  disabled={!canEdit}
                >
                  {MONTHS.map((m, idx) => (
                    <option key={idx + 1} value={idx + 1}>{m}</option>
                  ))}
                </select>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Address</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="line1">Line 1</Label>
              <Input id="line1" value={form.address_line1}
                onChange={e => updateField('address_line1', e.target.value)}
                disabled={!canEdit} />
            </div>
            <div>
              <Label htmlFor="line2">Line 2</Label>
              <Input id="line2" value={form.address_line2}
                onChange={e => updateField('address_line2', e.target.value)}
                disabled={!canEdit} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label htmlFor="city">City</Label>
                <Input id="city" value={form.address_city}
                  onChange={e => updateField('address_city', e.target.value)}
                  disabled={!canEdit} />
              </div>
              <div>
                <Label htmlFor="state">State / Region</Label>
                <Input id="state" value={form.address_state}
                  onChange={e => updateField('address_state', e.target.value)}
                  disabled={!canEdit} />
              </div>
              <div>
                <Label htmlFor="postal">Postal code</Label>
                <Input id="postal" value={form.address_postal_code}
                  onChange={e => updateField('address_postal_code', e.target.value)}
                  disabled={!canEdit} />
              </div>
            </div>
            <div>
              <Label htmlFor="country">Country</Label>
              <Input id="country" value={form.address_country}
                onChange={e => updateField('address_country', e.target.value)}
                disabled={!canEdit} placeholder="United States" />
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
            <Button
              type="button"
              variant="ghost"
              onClick={() => setForm(business ? toFormState(business) : null)}
              disabled={busy}
            >
              Reset
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
