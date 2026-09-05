import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/apiClient';
import { pickErr } from '@/lib/apiErrors';
import type { JournalAccount } from './journalEntryForm';

type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';

type JournalAccountDialogProps = {
  businessId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (account: JournalAccount) => void;
};

export default function JournalAccountDialog({
  businessId,
  open,
  onOpenChange,
  onCreated,
}: JournalAccountDialogProps) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [accountType, setAccountType] = useState<AccountType>('expense');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCode('');
    setName('');
    setAccountType('expense');
    setError(null);
  }, [open]);

  async function createAccount(event: React.FormEvent) {
    event.preventDefault();
    const trimmedCode = code.trim();
    const trimmedName = name.trim();
    if (!trimmedCode || !trimmedName) return;

    setBusy(true);
    setError(null);
    try {
      const response = await api.post<JournalAccount>(`/businesses/${businessId}/coa`, {
        code: trimmedCode,
        name: trimmedName,
        account_type: accountType,
      });
      onCreated(response.data);
      onOpenChange(false);
    } catch (requestError: unknown) {
      setError(pickErr(requestError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" aria-describedby={undefined}>
        <form id="new-journal-account-form" onSubmit={event => { void createAccount(event); }}>
          <DialogHeader>
            <DialogTitle>Add account</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 px-6 py-5">
            <div>
              <label className="mb-1.5 block text-sm font-medium" htmlFor="new-journal-account-code">
                Account code
              </label>
              <Input
                id="new-journal-account-code"
                value={code}
                onChange={event => setCode(event.target.value)}
                required
                autoFocus
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium" htmlFor="new-journal-account-name">
                Account name
              </label>
              <Input
                id="new-journal-account-name"
                value={name}
                onChange={event => setName(event.target.value)}
                required
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium" htmlFor="new-journal-account-type">
                Account type
              </label>
              <select
                id="new-journal-account-type"
                value={accountType}
                onChange={event => setAccountType(event.target.value as AccountType)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="asset">Asset</option>
                <option value="liability">Liability</option>
                <option value="equity">Equity</option>
                <option value="revenue">Revenue</option>
                <option value="expense">Expense</option>
              </select>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !code.trim() || !name.trim()}>
              {busy ? 'Adding...' : 'Add account'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
