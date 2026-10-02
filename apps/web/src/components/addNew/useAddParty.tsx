import { useState } from 'react';
import { api } from '@/lib/apiClient';
import { pickErr } from '@/lib/apiErrors';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

type PartyKind = 'vendor' | 'customer';
type Party = { id: string; name: string };

const ENDPOINT: Record<PartyKind, string> = { vendor: 'vendors', customer: 'customers' };

/**
 * "Add new vendor / customer" for any dropdown. A quick name + email dialog so
 * the form being filled in is not lost; the full record can be completed later
 * from the vendor or customer page.
 */
export function useAddParty<T extends Party>(kind: PartyKind, onCreated: (party: T) => void) {
  const [businessId] = useActiveBusinessId();
  const [onPick, setOnPick] = useState<((id: string) => void) | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function open(pick?: (id: string) => void) {
    setOnPick(() => pick ?? null);
    setName('');
    setEmail('');
    setError(null);
    setIsOpen(true);
  }

  async function save() {
    if (!businessId || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const response = await api.post<T>(`/businesses/${businessId}/${ENDPOINT[kind]}`, {
        name: name.trim(),
        email: email.trim() || null,
      });
      onCreated(response.data);
      onPick?.(response.data.id);
      setIsOpen(false);
    } catch (requestError: unknown) {
      setError(pickErr(requestError));
    } finally {
      setBusy(false);
    }
  }

  const dialog = (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>New {kind}</DialogTitle></DialogHeader>
        {/* A div, not a form: this dialog renders inside the page's own form. */}
        <div className="space-y-4 p-6">
          <div>
            <Label htmlFor="add-party-name">Name <span className="text-destructive">*</span></Label>
            <Input
              id="add-party-name"
              className="mt-1"
              value={name}
              onChange={event => setName(event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void save(); } }}
              autoFocus
            />
          </div>
          <div>
            <Label htmlFor="add-party-email">Email</Label>
            <Input
              id="add-party-email"
              type="email"
              className="mt-1"
              value={email}
              onChange={event => setEmail(event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void save(); } }}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setIsOpen(false)}>Cancel</Button>
          <Button type="button" disabled={busy || !name.trim()} onClick={() => { void save(); }}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { open, dialog };
}
