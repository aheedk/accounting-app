import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '@/lib/apiClient';
import { pickErr } from '@/lib/apiErrors';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export type QuickVendor = { id: string; name: string };

const emptyForm = () => ({
  companyName: '', displayName: '', displayNameEdited: false,
  firstName: '', lastName: '', email: '', phone: '',
  street: '', city: '', state: '', zip: '', country: '',
});

/**
 * Richer "Add new vendor" modal for the Document Inbox: enough fields to be a
 * useful vendor record (name, contact, address for 1099s later) without the
 * full vendor page's extended fields (tax info, payment terms, notes...).
 * Those stay one click away via the "Full details" link.
 */
export function useAddVendorQuick(onCreated: (vendor: QuickVendor) => void) {
  const [businessId] = useActiveBusinessId();
  const [isOpen, setIsOpen] = useState(false);
  const [onPick, setOnPick] = useState<((vendor: QuickVendor) => void) | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [addressOpen, setAddressOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);

  function open(pick?: (vendor: QuickVendor) => void) {
    setOnPick(() => pick ?? null);
    setForm(emptyForm());
    setAddressOpen(false);
    setError(null);
    setIsOpen(true);
  }

  function setCompanyName(value: string) {
    setForm(current => ({
      ...current,
      companyName: value,
      // Mirrors the display name until the user types their own -- the same
      // "suggest, don't overwrite a manual edit" pattern as the journal
      // number suggestion.
      displayName: current.displayNameEdited ? current.displayName : value,
    }));
  }

  function setDisplayName(value: string) {
    setForm(current => ({ ...current, displayName: value, displayNameEdited: true }));
  }

  async function save() {
    if (!businessId || !form.displayName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const addressEntries = Object.entries({
        line1: form.street.trim(), city: form.city.trim(), state: form.state.trim(),
        postal_code: form.zip.trim(), country: form.country.trim(),
      }).filter(([, value]) => value !== '');
      const response = await api.post<QuickVendor>(`/businesses/${businessId}/vendors`, {
        name: form.displayName.trim(),
        company_name: form.companyName.trim() || null,
        first_name: form.firstName.trim() || null,
        last_name: form.lastName.trim() || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        billing_address: addressEntries.length > 0 ? Object.fromEntries(addressEntries) : null,
      });
      onCreated(response.data);
      onPick?.(response.data);
      setIsOpen(false);
      setToastVisible(true);
      setTimeout(() => setToastVisible(false), 2500);
    } catch (requestError: unknown) {
      setError(pickErr(requestError));
    } finally {
      setBusy(false);
    }
  }

  const dialog = (
    <>
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>New vendor</DialogTitle></DialogHeader>
          {/* A div, not a form: this dialog renders inside the page's own form. */}
          <div className="max-h-[70vh] space-y-4 overflow-y-auto p-6">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="quick-vendor-company">Company name</Label>
                <Input
                  id="quick-vendor-company"
                  className="mt-1"
                  value={form.companyName}
                  onChange={event => setCompanyName(event.target.value)}
                  autoFocus
                />
              </div>
              <div>
                <Label htmlFor="quick-vendor-display-name">Vendor display name <span className="text-destructive">*</span></Label>
                <Input
                  id="quick-vendor-display-name"
                  className="mt-1"
                  value={form.displayName}
                  onChange={event => setDisplayName(event.target.value)}
                  onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void save(); } }}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="quick-vendor-first-name">First name</Label>
                <Input
                  id="quick-vendor-first-name"
                  className="mt-1"
                  value={form.firstName}
                  onChange={event => setForm(current => ({ ...current, firstName: event.target.value }))}
                />
              </div>
              <div>
                <Label htmlFor="quick-vendor-last-name">Last name</Label>
                <Input
                  id="quick-vendor-last-name"
                  className="mt-1"
                  value={form.lastName}
                  onChange={event => setForm(current => ({ ...current, lastName: event.target.value }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="quick-vendor-email">Email</Label>
                <Input
                  id="quick-vendor-email"
                  type="email"
                  className="mt-1"
                  value={form.email}
                  onChange={event => setForm(current => ({ ...current, email: event.target.value }))}
                />
              </div>
              <div>
                <Label htmlFor="quick-vendor-phone">Phone number</Label>
                <Input
                  id="quick-vendor-phone"
                  className="mt-1"
                  value={form.phone}
                  onChange={event => setForm(current => ({ ...current, phone: event.target.value }))}
                />
              </div>
            </div>

            <div className="rounded-md border">
              <button
                type="button"
                onClick={() => setAddressOpen(current => !current)}
                className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm font-medium"
              >
                <span>Address</span>
                {addressOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
              </button>
              {addressOpen && (
                <div className="space-y-3 border-t p-3">
                  <div>
                    <Label htmlFor="quick-vendor-street">Street</Label>
                    <Input
                      id="quick-vendor-street"
                      className="mt-1"
                      value={form.street}
                      onChange={event => setForm(current => ({ ...current, street: event.target.value }))}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="quick-vendor-city">City</Label>
                      <Input
                        id="quick-vendor-city"
                        className="mt-1"
                        value={form.city}
                        onChange={event => setForm(current => ({ ...current, city: event.target.value }))}
                      />
                    </div>
                    <div>
                      <Label htmlFor="quick-vendor-state">State</Label>
                      <Input
                        id="quick-vendor-state"
                        className="mt-1"
                        value={form.state}
                        onChange={event => setForm(current => ({ ...current, state: event.target.value }))}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="quick-vendor-zip">ZIP code</Label>
                      <Input
                        id="quick-vendor-zip"
                        className="mt-1"
                        value={form.zip}
                        onChange={event => setForm(current => ({ ...current, zip: event.target.value }))}
                      />
                    </div>
                    <div>
                      <Label htmlFor="quick-vendor-country">Country</Label>
                      <Input
                        id="quick-vendor-country"
                        className="mt-1"
                        value={form.country}
                        onChange={event => setForm(current => ({ ...current, country: event.target.value }))}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter className="items-center sm:justify-between">
            <a
              href="/ap/vendors/new"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-primary hover:underline"
            >
              Full details
            </a>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setIsOpen(false)}>Cancel</Button>
              <Button type="button" disabled={busy || !form.displayName.trim()} onClick={() => { void save(); }}>
                {busy ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {toastVisible && (
        <div className="fixed bottom-6 right-6 z-[60] rounded-md bg-foreground px-4 py-2.5 text-sm font-medium text-background shadow-lg">
          Vendor created
        </div>
      )}
    </>
  );

  return { open, dialog };
}
