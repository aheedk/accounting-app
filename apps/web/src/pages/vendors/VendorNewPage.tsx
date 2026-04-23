import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type VendorForm = {
  name: string;
  email: string;
  phone: string;
  tax_id: string;
  default_terms_days: number;
  is_1099: boolean;
};

export default function VendorNewPage() {
  const [bizId] = useActiveBusinessId();
  const nav = useNavigate();
  const [form, setForm] = useState<VendorForm>({ name: '', email: '', phone: '', tax_id: '', default_terms_days: 30, is_1099: false });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(null); setBusy(true);
    try {
      const body = {
        name: form.name,
        email: form.email || null,
        phone: form.phone || null,
        tax_id: form.tax_id || null,
        default_terms_days: form.default_terms_days,
        is_1099: form.is_1099,
      };
      const r = await api.post(`/businesses/${bizId}/vendors`, body);
      nav(`/ap/vendors/${r.data.id}`);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
      setErr(msg ?? 'Failed');
    }
    finally { setBusy(false); }
  }
  if (!bizId) return <div>Pick a business.</div>;
  return (
    <form className="space-y-6 max-w-xl" onSubmit={submit}>
      <h1 className="text-2xl font-semibold">New Vendor</h1>
      <Card><CardHeader><CardTitle>Details</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div><Label>Name</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required /></div>
          <div><Label>Email</Label><Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>
          <div><Label>Phone</Label><Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} /></div>
          <div><Label>Tax ID</Label><Input value={form.tax_id} onChange={e => setForm(f => ({ ...f, tax_id: e.target.value }))} placeholder="e.g. 12-3456789" /></div>
          <div><Label>Default terms (days)</Label><Input type="number" value={form.default_terms_days} onChange={e => setForm(f => ({ ...f, default_terms_days: parseInt(e.target.value, 10) || 0 }))} /></div>
          <div className="flex items-center gap-2 pt-2">
            <input id="is_1099" type="checkbox" className="h-4 w-4 rounded border" checked={form.is_1099} onChange={e => setForm(f => ({ ...f, is_1099: e.target.checked }))} />
            <Label htmlFor="is_1099" className="cursor-pointer">1099 contractor</Label>
          </div>
        </CardContent>
      </Card>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <div className="flex gap-2"><Button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create'}</Button><Button type="button" variant="outline" onClick={() => nav('/ap/vendors')}>Cancel</Button></div>
    </form>
  );
}
