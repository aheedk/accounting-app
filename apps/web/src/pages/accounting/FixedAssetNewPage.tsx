import { useEffect, useState } from 'react';
import { DateInput } from '@/components/ui/date-input';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AccountSelect } from '@/components/ui/AccountSelect';
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

type CreatedAsset = { id: string };

type CreateBody = {
  name: string;
  asset_account_id: string;
  depreciation_expense_account_id: string;
  accumulated_depreciation_account_id: string;
  purchase_date: string;
  cost: string;
  salvage_value: string;
  useful_life_years: number;
  memo: string | null;
};

export default function FixedAssetNewPage() {
  const [bizId] = useActiveBusinessId();
  const nav = useNavigate();
  const today = new Date().toISOString().slice(0, 10);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [form, setForm] = useState({
    name: '',
    asset_account_id: '',
    depreciation_expense_account_id: '',
    accumulated_depreciation_account_id: '',
    purchase_date: today,
    cost: '0.00',
    salvage_value: '0',
    useful_life_years: '5',
    memo: '',
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!bizId) return;
    api.get<CoaResponse>(`/businesses/${bizId}/coa`).then((r) => setAccounts(r.data.accounts));
  }, [bizId]);

  const assetAccounts = accounts.filter((a) => a.account_type === 'asset' && a.is_active);
  const expenseAccounts = accounts.filter((a) => a.account_type === 'expense' && a.is_active);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const years = parseInt(form.useful_life_years, 10);
      if (!Number.isFinite(years) || years < 1) {
        throw new Error('Useful life years must be a positive integer');
      }
      const body: CreateBody = {
        name: form.name,
        asset_account_id: form.asset_account_id,
        depreciation_expense_account_id: form.depreciation_expense_account_id,
        accumulated_depreciation_account_id: form.accumulated_depreciation_account_id,
        purchase_date: form.purchase_date,
        cost: parseMoneyInput(form.cost),
        salvage_value: parseMoneyInput(form.salvage_value || '0'),
        useful_life_years: years,
        memo: form.memo.trim() === '' ? null : form.memo,
      };
      const r = await api.post<CreatedAsset>(`/businesses/${bizId}/fixed-assets`, body);
      nav(`/accounting/fixed-assets/${r.data.id}`);
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message ??
        (e instanceof Error ? e.message : undefined);
      setErr(msg ?? 'Failed to create fixed asset');
    } finally {
      setBusy(false);
    }
  }

  if (!bizId) return <div>Pick a business.</div>;

  return (
    <form className="space-y-6" onSubmit={submit}>
      <h1 className="text-2xl font-semibold">New Fixed Asset</h1>
      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label>Name</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Delivery van #2"
              required
            />
          </div>
          <div>
            <Label>Asset account (debit)</Label>
            <AccountSelect
              accounts={assetAccounts}
              value={form.asset_account_id}
              onChange={(id) => setForm((f) => ({ ...f, asset_account_id: id }))}
              required
              placeholder="Search asset account…"
            />
          </div>
          <div>
            <Label>Depreciation expense account (debit)</Label>
            <AccountSelect
              accounts={expenseAccounts}
              value={form.depreciation_expense_account_id}
              onChange={(id) => setForm((f) => ({ ...f, depreciation_expense_account_id: id }))}
              required
              placeholder="Search depreciation expense…"
            />
          </div>
          <div>
            <Label>Accumulated depreciation account (credit)</Label>
            <AccountSelect
              accounts={assetAccounts}
              value={form.accumulated_depreciation_account_id}
              onChange={(id) => setForm((f) => ({ ...f, accumulated_depreciation_account_id: id }))}
              required
              placeholder="Search accumulated depreciation…"
            />
          </div>
          <div>
            <Label>Purchase date</Label>
            <DateInput
              value={form.purchase_date}
              onChange={(e) => setForm((f) => ({ ...f, purchase_date: e.target.value }))}
              required
            />
          </div>
          <div>
            <Label>Cost</Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              value={form.cost}
              onChange={(e) => setForm((f) => ({ ...f, cost: e.target.value }))}
              placeholder="0.00"
              className="text-right font-mono"
              required
            />
          </div>
          <div>
            <Label>Salvage value</Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              value={form.salvage_value}
              onChange={(e) => setForm((f) => ({ ...f, salvage_value: e.target.value }))}
              placeholder="0.00"
              className="text-right font-mono"
            />
          </div>
          <div>
            <Label>Useful life (years)</Label>
            <Input
              type="number"
              step="1"
              min="1"
              max="100"
              value={form.useful_life_years}
              onChange={(e) => setForm((f) => ({ ...f, useful_life_years: e.target.value }))}
              placeholder="5"
              required
            />
          </div>
          <div className="col-span-2">
            <Label>Memo</Label>
            <Input
              value={form.memo}
              onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))}
              placeholder="Optional note (serial #, location, etc.)"
            />
          </div>
        </CardContent>
      </Card>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Create fixed asset'}
        </Button>
        <Button type="button" variant="outline" onClick={() => nav('/accounting/fixed-assets')}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
