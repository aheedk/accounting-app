import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { parseMoneyInput } from '@/lib/money';

type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';

type Account = {
  id: string;
  code: string;
  name: string;
  account_type: AccountType;
  is_system: boolean;
  is_active: boolean;
};

type CoaResponse = { accounts: Account[] };

type CreatedItem = { id: string };

type CreateBody = {
  sku: string;
  name: string;
  description: string | null;
  unit_of_measure: string;
  purchase_cost: string | null;
  sale_price: string | null;
  income_account_id: string | null;
  expense_account_id: string | null;
  inventory_asset_account_id: string | null;
};

export default function InventoryNewPage() {
  const [bizId] = useActiveBusinessId();
  const nav = useNavigate();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [form, setForm] = useState({
    sku: '',
    name: '',
    description: '',
    unit_of_measure: 'each',
    purchase_cost: '',
    sale_price: '',
    income_account_id: '',
    expense_account_id: '',
    inventory_asset_account_id: '',
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!bizId) return;
    api.get<CoaResponse>(`/businesses/${bizId}/coa`).then((r) => setAccounts(r.data.accounts));
  }, [bizId]);

  const revenueAccounts = accounts.filter((a) => a.account_type === 'revenue' && a.is_active);
  const expenseAccounts = accounts.filter((a) => a.account_type === 'expense' && a.is_active);
  const assetAccounts = accounts.filter((a) => a.account_type === 'asset' && a.is_active);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const body: CreateBody = {
        sku: form.sku.trim(),
        name: form.name.trim(),
        description: form.description.trim() === '' ? null : form.description,
        unit_of_measure: form.unit_of_measure.trim() === '' ? 'each' : form.unit_of_measure,
        purchase_cost: form.purchase_cost.trim() === '' ? null : parseMoneyInput(form.purchase_cost),
        sale_price: form.sale_price.trim() === '' ? null : parseMoneyInput(form.sale_price),
        income_account_id: form.income_account_id || null,
        expense_account_id: form.expense_account_id || null,
        inventory_asset_account_id: form.inventory_asset_account_id || null,
      };
      const r = await api.post<CreatedItem>(`/businesses/${bizId}/inventory-items`, body);
      nav(`/inventory/items/${r.data.id}`);
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message ??
        (e instanceof Error ? e.message : undefined);
      setErr(msg ?? 'Failed to create inventory item');
    } finally {
      setBusy(false);
    }
  }

  if (!bizId) return <div>Pick a business.</div>;

  return (
    <form className="space-y-6" onSubmit={submit}>
      <h1 className="text-2xl font-semibold">New Inventory Item</h1>
      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
          <div>
            <Label>SKU</Label>
            <Input
              value={form.sku}
              onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))}
              required
            />
          </div>
          <div>
            <Label>Name</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              required
            />
          </div>
          <div className="col-span-2">
            <Label>Description</Label>
            <Input
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>
          <div>
            <Label>Unit of measure</Label>
            <Input
              value={form.unit_of_measure}
              onChange={(e) => setForm((f) => ({ ...f, unit_of_measure: e.target.value }))}
            />
          </div>
          <div>
            <Label>Purchase cost</Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={form.purchase_cost}
              onChange={(e) => setForm((f) => ({ ...f, purchase_cost: e.target.value }))}
            />
          </div>
          <div>
            <Label>Sale price</Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={form.sale_price}
              onChange={(e) => setForm((f) => ({ ...f, sale_price: e.target.value }))}
            />
          </div>
          <div>
            <Label>Income account (revenue)</Label>
            <select
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={form.income_account_id}
              onChange={(e) => setForm((f) => ({ ...f, income_account_id: e.target.value }))}
            >
              <option value="">None</option>
              {revenueAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} — {a.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>Expense account</Label>
            <select
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={form.expense_account_id}
              onChange={(e) => setForm((f) => ({ ...f, expense_account_id: e.target.value }))}
            >
              <option value="">None</option>
              {expenseAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} — {a.name}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <Label>Inventory asset account</Label>
            <select
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={form.inventory_asset_account_id}
              onChange={(e) => setForm((f) => ({ ...f, inventory_asset_account_id: e.target.value }))}
            >
              <option value="">None</option>
              {assetAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} — {a.name}
                </option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Create item'}
        </Button>
        <Button type="button" variant="outline" onClick={() => nav('/inventory/items')}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
