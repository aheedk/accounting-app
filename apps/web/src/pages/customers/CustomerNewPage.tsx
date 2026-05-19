import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function CustomerNewPage() {
  const [bizId] = useActiveBusinessId();
  const nav = useNavigate();
  const [form, setForm] = useState({ name: '', company_name: '', email: '', phone: '', default_terms_days: 30 });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(null); setBusy(true);
    try {
      const body = { name: form.name, company_name: form.company_name || null, email: form.email || null, phone: form.phone || null, default_terms_days: form.default_terms_days };
      const r = await api.post(`/businesses/${bizId}/customers`, body);
      nav(`/customers/${r.data.id}`);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
      setErr(msg ?? 'Failed');
    }
    finally { setBusy(false); }
  }
  if (!bizId) return <div>Pick a business.</div>;
  return (
    <form className="space-y-6 max-w-xl" onSubmit={submit}>
      <h1 className="text-2xl font-semibold">New Customer</h1>
      <Card><CardHeader><CardTitle>Details</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div><Label>Name</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required /></div>
          <div><Label>Company name</Label><Input value={form.company_name} onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))} /></div>
          <div><Label>Email</Label><Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>
          <div><Label>Phone</Label><Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} /></div>
          <div><Label>Default terms (days)</Label><Input type="number" value={form.default_terms_days} onChange={e => setForm(f => ({ ...f, default_terms_days: parseInt(e.target.value, 10) || 0 }))} /></div>
        </CardContent>
      </Card>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <div className="flex gap-2"><Button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create'}</Button><Button type="button" variant="outline" onClick={() => nav('/customers')}>Cancel</Button></div>
    </form>
  );
}
