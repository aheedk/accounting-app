import { useEffect, useState } from 'react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type Account = {
  id: string;
  name: string;
  institution: string | null;
  account_last_four: string | null;
  cash_account_id: string;
  is_active: boolean;
  cash_account_code: string;
  cash_account_name: string;
};

type CashAccountRow = {
  id: string;
  code: string;
  name: string;
  account_type: string;
  is_system: boolean;
  is_active: boolean;
};

export default function BankAccountListPage() {
  const [bizId] = useActiveBusinessId();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [cashAccounts, setCashAccounts] = useState<CashAccountRow[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', institution: '', account_last_four: '', cash_account_id: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload() {
    if (!bizId) return;
    const r = await api.get(`/businesses/${bizId}/bank-accounts`);
    setAccounts(r.data.bank_accounts);
  }

  useEffect(() => {
    if (!bizId) return;
    reload();
    api.get(`/businesses/${bizId}/coa`).then(r => {
      const rows = r.data.accounts as CashAccountRow[];
      setCashAccounts(rows.filter(a => a.account_type === 'asset' && a.is_active && a.code.startsWith('10')));
    });
  }, [bizId]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await api.post(`/businesses/${bizId}/bank-accounts`, {
        name: form.name,
        institution: form.institution || null,
        account_last_four: form.account_last_four || null,
        cash_account_id: form.cash_account_id,
      });
      setForm({ name: '', institution: '', account_last_four: '', cash_account_id: '' });
      setShowCreate(false);
      await reload();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
      setErr(msg ?? 'Failed');
    } finally {
      setBusy(false);
    }
  }

  if (!bizId) return <div>Pick a business.</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Bank Accounts</h1>
        <Button onClick={() => setShowCreate(s => !s)}>{showCreate ? 'Cancel' : 'Add bank account'}</Button>
      </div>

      {showCreate && (
        <Card>
          <CardHeader><CardTitle>New bank account</CardTitle></CardHeader>
          <CardContent>
            <form className="space-y-3" onSubmit={create}>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Name</Label>
                  <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
                </div>
                <div>
                  <Label>Institution</Label>
                  <Input value={form.institution} onChange={e => setForm(f => ({ ...f, institution: e.target.value }))} />
                </div>
                <div>
                  <Label>Last 4</Label>
                  <Input value={form.account_last_four} onChange={e => setForm(f => ({ ...f, account_last_four: e.target.value }))} maxLength={4} placeholder="1234" />
                </div>
                <div>
                  <Label>Cash account</Label>
                  <select
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                    value={form.cash_account_id}
                    onChange={e => setForm(f => ({ ...f, cash_account_id: e.target.value }))}
                    required
                  >
                    <option value="">Select…</option>
                    {cashAccounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                  </select>
                </div>
              </div>
              {err && <p className="text-sm text-destructive">{err}</p>}
              <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Create'}</Button>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40">
              <tr>
                <th className="text-left p-3">Name</th>
                <th className="text-left p-3">Institution</th>
                <th className="text-left p-3">Last 4</th>
                <th className="text-left p-3">Linked CoA</th>
                <th className="text-left p-3">Active</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map(a => (
                <tr key={a.id} className="border-b last:border-b-0">
                  <td className="p-3">{a.name}</td>
                  <td className="p-3">{a.institution ?? ''}</td>
                  <td className="p-3 font-mono">{a.account_last_four ?? ''}</td>
                  <td className="p-3 font-mono">{a.cash_account_code} — {a.cash_account_name}</td>
                  <td className="p-3">{a.is_active ? 'yes' : 'no'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
