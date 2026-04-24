import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { useAuth } from '@/auth/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// Decision: skip the inline "mark vendor as 1099" form on this page.
// Users flag a vendor as 1099 from the existing Vendors page (or by editing W-9 here,
// which sets is_1099 = true). Keeps this page focused on W-9 management.

type Contractor = {
  id: string;
  business_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  is_1099: boolean;
  tax_id_last_four: string | null;
  tax_id_type: 'SSN' | 'EIN' | null;
  default_terms_days: number;
};

type RevealState = { id: string; tax_id: string | null };

type EditForm = {
  tax_id: string;
  tax_id_type: 'SSN' | 'EIN';
  is_1099: boolean;
};

function maskTaxId(type: 'SSN' | 'EIN' | null, lastFour: string | null): string {
  if (!type || !lastFour) return '—';
  if (type === 'SSN') return `***-**-${lastFour}`;
  return `**-***${lastFour}`;
}

export default function ContractorsPage() {
  const [bizId] = useActiveBusinessId();
  const { user } = useAuth();
  const isFirmAdmin = user?.role === 'firm_admin';
  const [items, setItems] = useState<Contractor[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reveal, setReveal] = useState<RevealState | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({ tax_id: '', tax_id_type: 'SSN', is_1099: true });
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  async function reload() {
    if (!bizId) return;
    setLoading(true);
    setError(null);
    try {
      const r = await api.get(`/businesses/${bizId}/contractors`);
      setItems(r.data.vendors as Contractor[]);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
      setError(msg ?? 'Failed to load contractors');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bizId]);

  // Auto-hide revealed tax_id after 30s
  useEffect(() => {
    if (!reveal) return;
    const t = window.setTimeout(() => setReveal(null), 30_000);
    return () => window.clearTimeout(t);
  }, [reveal]);

  async function handleReveal(c: Contractor) {
    if (!bizId) return;
    try {
      const r = await api.get(`/businesses/${bizId}/vendors/${c.id}/tax-id-reveal`);
      setReveal({ id: c.id, tax_id: (r.data.tax_id as string | null) ?? null });
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
      setError(msg ?? 'Failed to reveal tax ID');
    }
  }

  function startEdit(c: Contractor) {
    setEditingId(c.id);
    setEditForm({
      tax_id: '',
      tax_id_type: c.tax_id_type ?? 'SSN',
      is_1099: c.is_1099,
    });
    setEditError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditError(null);
  }

  async function submitEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!bizId || !editingId) return;
    setEditBusy(true);
    setEditError(null);
    try {
      const trimmed = editForm.tax_id.trim();
      const body: { is_1099: boolean; tax_id?: string | null; tax_id_type?: 'SSN' | 'EIN' | null } = {
        is_1099: editForm.is_1099,
      };
      if (trimmed.length > 0) {
        body.tax_id = trimmed;
        body.tax_id_type = editForm.tax_id_type;
      }
      await api.patch(`/businesses/${bizId}/vendors/${editingId}`, body);
      setEditingId(null);
      await reload();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
      setEditError(msg ?? 'Failed to save W-9');
    } finally {
      setEditBusy(false);
    }
  }

  async function clearW9(c: Contractor) {
    if (!bizId) return;
    if (!window.confirm(`Clear W-9 (tax ID) for ${c.name}?`)) return;
    try {
      await api.patch(`/businesses/${bizId}/vendors/${c.id}`, { tax_id: null, tax_id_type: null });
      await reload();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
      setError(msg ?? 'Failed to clear W-9');
    }
  }

  if (!bizId) return <div>Pick a business.</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Contractors (1099)</h1>
        <p className="text-sm text-muted-foreground">
          Vendors flagged as 1099 contractors. Manage W-9 fields and reveal full tax IDs (firm admin only). Mark a new vendor as 1099 from the Vendors page or by editing W-9 here.
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40">
              <tr>
                <th className="text-left p-3">Name</th>
                <th className="text-left p-3">Email</th>
                <th className="text-left p-3">Tax ID Type</th>
                <th className="text-left p-3">Tax ID</th>
                <th className="text-right p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && !loading && (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-sm text-muted-foreground">
                    No 1099 contractors yet. Mark a vendor as 1099 from the{' '}
                    <Link to="/ap/vendors" className="text-primary underline">Vendors page</Link>.
                  </td>
                </tr>
              )}
              {loading && items.length === 0 && (
                <tr><td colSpan={5} className="p-6 text-center text-sm text-muted-foreground">Loading…</td></tr>
              )}
              {items.map(c => {
                const showRevealed = reveal && reveal.id === c.id;
                return (
                  <tr key={c.id} className="border-b last:border-b-0 align-top">
                    <td className="p-3">{c.name}</td>
                    <td className="p-3">{c.email ?? ''}</td>
                    <td className="p-3">
                      {c.tax_id_type ? (
                        <span className="inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                          {c.tax_id_type}
                        </span>
                      ) : (
                        <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="p-3 font-mono">
                      {showRevealed ? (
                        <span className="rounded bg-amber-100 px-2 py-0.5 text-amber-900">
                          {reveal!.tax_id ?? '—'}
                          <span className="ml-2 text-xs text-amber-700">(hides in 30s)</span>
                        </span>
                      ) : (
                        maskTaxId(c.tax_id_type, c.tax_id_last_four)
                      )}
                    </td>
                    <td className="p-3 text-right space-x-2">
                      {isFirmAdmin && c.tax_id_last_four && (
                        showRevealed ? (
                          <Button size="sm" variant="outline" onClick={() => setReveal(null)}>Hide</Button>
                        ) : (
                          <Button size="sm" variant="outline" onClick={() => handleReveal(c)}>Reveal</Button>
                        )
                      )}
                      <Button size="sm" variant="outline" onClick={() => startEdit(c)}>Edit W-9</Button>
                      {c.tax_id_last_four && (
                        <Button size="sm" variant="ghost" onClick={() => clearW9(c)}>Clear</Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {editingId && (
        <Card>
          <CardHeader><CardTitle>Edit W-9</CardTitle></CardHeader>
          <CardContent>
            <form className="space-y-3" onSubmit={submitEdit}>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Tax ID type</Label>
                  <select
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                    value={editForm.tax_id_type}
                    onChange={e => setEditForm(f => ({ ...f, tax_id_type: e.target.value as 'SSN' | 'EIN' }))}
                  >
                    <option value="SSN">SSN</option>
                    <option value="EIN">EIN</option>
                  </select>
                </div>
                <div>
                  <Label>Tax ID</Label>
                  <Input
                    value={editForm.tax_id}
                    onChange={e => setEditForm(f => ({ ...f, tax_id: e.target.value }))}
                    placeholder={editForm.tax_id_type === 'SSN' ? '123-45-6789' : '12-3456789'}
                    autoComplete="off"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">Leave blank to keep current value.</p>
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={editForm.is_1099}
                  onChange={e => setEditForm(f => ({ ...f, is_1099: e.target.checked }))}
                />
                Issue 1099 to this vendor
              </label>
              {editError && <p className="text-sm text-destructive">{editError}</p>}
              <div className="flex gap-2">
                <Button type="submit" disabled={editBusy}>{editBusy ? 'Saving…' : 'Save'}</Button>
                <Button type="button" variant="outline" onClick={cancelEdit} disabled={editBusy}>Cancel</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
