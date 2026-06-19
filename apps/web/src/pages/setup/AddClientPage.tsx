import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useAuth } from '@/auth/useAuth';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type CreatedBusiness = { id: string; name: string };

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

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

const EMPTY: FormState = {
  name: '', legal_name: '', tax_id: '', fiscal_year_start_month: 1,
  address_line1: '', address_line2: '', address_city: '',
  address_state: '', address_postal_code: '', address_country: '',
};

export default function AddClientPage() {
  const { user, refresh } = useAuth();
  const navigate = useNavigate();
  const [, setActiveBusiness] = useActiveBusinessId();
  const canEdit = user?.role === 'firm_admin';

  const [form, setForm] = useState<FormState>(EMPTY);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(f => ({ ...f, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canEdit) return;
    setErr(null);
    setBusy(true);
    try {
      const addressProvided = Boolean(
        form.address_line1 || form.address_line2 || form.address_city ||
        form.address_state || form.address_postal_code || form.address_country,
      );
      const address = addressProvided
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
      const r = await api.post<CreatedBusiness>('/firm/businesses', payload);
      // Refresh access list, switch into the new client, and land on its dashboard.
      await refresh();
      setActiveBusiness(r.data.id);
      navigate('/');
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)
        ?.response?.data?.error?.message;
      setErr(msg ?? 'Failed to add client');
    } finally {
      setBusy(false);
    }
  }

  if (!canEdit) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">Add a client</h1>
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            Only firm admins can add clients.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Add a client</h1>
        <p className="text-sm text-muted-foreground">
          Create a new client company. It starts with a default chart of accounts
          and this year's fiscal periods, and is added to your company switcher.
        </p>
      </div>

      <form onSubmit={submit} className="space-y-6">
        <Card>
          <CardHeader><CardTitle>Business details</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="name">Company name</Label>
                <Input id="name" value={form.name} required
                  onChange={e => updateField('name', e.target.value)}
                  placeholder="Acme Manufacturing Inc." />
              </div>
              <div>
                <Label htmlFor="legal_name">Legal name</Label>
                <Input id="legal_name" value={form.legal_name}
                  onChange={e => updateField('legal_name', e.target.value)} />
              </div>
              <div>
                <Label htmlFor="tax_id">Tax ID (EIN)</Label>
                <Input id="tax_id" value={form.tax_id}
                  onChange={e => updateField('tax_id', e.target.value)}
                  placeholder="12-3456789" />
              </div>
              <div>
                <Label htmlFor="fy_month">Fiscal year starts</Label>
                <select
                  id="fy_month"
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={form.fiscal_year_start_month}
                  onChange={e => updateField('fiscal_year_start_month', parseInt(e.target.value, 10))}
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
          <CardHeader><CardTitle>Address <span className="text-sm font-normal text-muted-foreground">(optional)</span></CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="line1">Line 1</Label>
              <Input id="line1" value={form.address_line1}
                onChange={e => updateField('address_line1', e.target.value)} />
            </div>
            <div>
              <Label htmlFor="line2">Line 2</Label>
              <Input id="line2" value={form.address_line2}
                onChange={e => updateField('address_line2', e.target.value)} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label htmlFor="city">City</Label>
                <Input id="city" value={form.address_city}
                  onChange={e => updateField('address_city', e.target.value)} />
              </div>
              <div>
                <Label htmlFor="state">State / Region</Label>
                <Input id="state" value={form.address_state}
                  onChange={e => updateField('address_state', e.target.value)} />
              </div>
              <div>
                <Label htmlFor="postal">Postal code</Label>
                <Input id="postal" value={form.address_postal_code}
                  onChange={e => updateField('address_postal_code', e.target.value)} />
              </div>
            </div>
            <div>
              <Label htmlFor="country">Country</Label>
              <Input id="country" value={form.address_country}
                onChange={e => updateField('address_country', e.target.value)}
                placeholder="United States" />
            </div>
          </CardContent>
        </Card>

        {err && <p className="text-sm text-destructive">{err}</p>}

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={busy || form.name.trim() === ''}>
            {busy ? 'Adding…' : 'Add client'}
          </Button>
          <Button type="button" variant="ghost" onClick={() => navigate('/accounting/client-overview')} disabled={busy}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
