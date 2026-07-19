import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { useAuth } from '@/auth/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FileDown, Printer } from 'lucide-react';
import { downloadAsExcel } from '@/lib/download';

type CostCenter = {
  id: string;
  business_id: string;
  name: string;
  code: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type FormState = { name: string; code: string };

function errorMessage(e: unknown): string {
  return (e as { response?: { data?: { error?: { message?: string } } } } | undefined)
    ?.response?.data?.error?.message ?? 'Request failed';
}

function statusBadge(active: boolean) {
  const base = 'inline-flex rounded-full px-2 py-0.5 text-xs font-medium';
  return active
    ? <span className={`${base} bg-emerald-100 text-emerald-800`}>Active</span>
    : <span className={`${base} bg-muted text-muted-foreground`}>Inactive</span>;
}

export default function CostCentersPage() {
  const [bizId] = useActiveBusinessId();
  const { user } = useAuth();
  const canEdit = user?.role === 'firm_admin' || user?.role === 'accountant';

  const [items, setItems] = useState<CostCenter[]>([]);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<FormState>({ name: '', code: '' });
  const [createBusy, setCreateBusy] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);

  const [editing, setEditing] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<FormState>({ name: '', code: '' });
  const [editBusy, setEditBusy] = useState(false);
  const [editErr, setEditErr] = useState<string | null>(null);
  const [excelBusy, setExcelBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!bizId) return;
    setErr(null);
    try {
      const r = await api.get<{ cost_centers: CostCenter[] }>(
        `/businesses/${bizId}/cost-centers${includeInactive ? '?include_inactive=true' : ''}`,
      );
      setItems(r.data.cost_centers);
    } catch (e) {
      setErr(errorMessage(e));
    }
  }, [bizId, includeInactive]);

  useEffect(() => { void reload(); }, [reload]);

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!bizId) return;
    setCreateErr(null);
    setCreateBusy(true);
    try {
      await api.post(`/businesses/${bizId}/cost-centers`, {
        name: form.name,
        code: form.code.trim() === '' ? null : form.code.trim(),
      });
      setForm({ name: '', code: '' });
      setShowCreate(false);
      await reload();
    } catch (e) {
      setCreateErr(errorMessage(e));
    } finally {
      setCreateBusy(false);
    }
  }

  function startEdit(c: CostCenter) {
    setEditing(c.id);
    setEditForm({ name: c.name, code: c.code ?? '' });
    setEditErr(null);
  }

  async function submitEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!bizId || !editing) return;
    setEditErr(null);
    setEditBusy(true);
    try {
      await api.patch(`/businesses/${bizId}/cost-centers/${editing}`, {
        name: editForm.name,
        code: editForm.code.trim() === '' ? null : editForm.code.trim(),
      });
      setEditing(null);
      await reload();
    } catch (e) {
      setEditErr(errorMessage(e));
    } finally {
      setEditBusy(false);
    }
  }

  async function toggleActive(c: CostCenter) {
    if (!bizId) return;
    try {
      await api.patch(`/businesses/${bizId}/cost-centers/${c.id}`, { is_active: !c.is_active });
      await reload();
    } catch (e) {
      setErr(errorMessage(e));
    }
  }

  async function softDelete(id: string) {
    if (!bizId) return;
    try {
      await api.delete(`/businesses/${bizId}/cost-centers/${id}`);
      await reload();
    } catch (e) {
      setErr(errorMessage(e));
    }
  }

  if (!bizId) return <div>Pick a business.</div>;

  const dlHeaders = ['Name', 'Code', 'Active'];
  const dlRows = () => items.map(c => [c.name, c.code ?? '', c.is_active ? 'Yes' : 'No']);

  function handleExport() {
    setExcelBusy(true);
    try { downloadAsExcel(dlHeaders, dlRows(), 'cost-centers'); } finally { setExcelBusy(false); }
  }

  function handlePrint() {
    const rowsHtml = dlRows().map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('');
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><title>Cost Centers</title><style>body{font-family:Arial,sans-serif;font-size:11px;margin:24px}h2{margin-bottom:4px}p{color:#666;font-size:10px;margin-bottom:16px}table{width:100%;border-collapse:collapse}th{background:#f0f0f0;text-align:left;padding:5px 7px;border-bottom:2px solid #ccc;font-size:10px;text-transform:uppercase}td{padding:4px 7px;border-bottom:1px solid #e5e5e5}</style></head><body><h2>Cost Centers</h2><p>Generated ${new Date().toLocaleDateString()}</p><table><thead><tr>${dlHeaders.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rowsHtml}</tbody></table><script>window.onload=function(){window.print()}</script></body></html>`);
    win.document.close();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Cost centers</h1>
          <p className="text-sm text-muted-foreground">
            Departments, classes, and locations. Ledger tagging arrives later —
            for now this is master data only.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative group">
            <button className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50" onClick={handleExport} disabled={excelBusy} aria-label="Export to Excel">
              <FileDown className="h-4 w-4" />
            </button>
            <div className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">Export to Excel</div>
          </div>
          <div className="relative group">
            <button className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground" onClick={handlePrint} aria-label="Print">
              <Printer className="h-4 w-4" />
            </button>
            <div className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">Print</div>
          </div>
          {canEdit && (
            <Button onClick={() => setShowCreate(s => !s)}>
              {showCreate ? 'Cancel' : 'Add cost center'}
            </Button>
          )}
        </div>
      </div>

      {err && <p className="text-sm text-destructive">{err}</p>}

      {showCreate && canEdit && (
        <Card>
          <CardHeader><CardTitle>New cost center</CardTitle></CardHeader>
          <CardContent>
            <form className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end" onSubmit={submitCreate}>
              <div>
                <Label>Name</Label>
                <Input required value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div>
                <Label>Code (optional)</Label>
                <Input value={form.code}
                  onChange={e => setForm(f => ({ ...f, code: e.target.value }))} />
              </div>
              <div>
                <Button type="submit" disabled={createBusy}>
                  {createBusy ? 'Saving…' : 'Create'}
                </Button>
              </div>
              {createErr && <p className="text-sm text-destructive md:col-span-3">{createErr}</p>}
            </form>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center gap-2 text-sm">
        <input
          id="include-inactive"
          type="checkbox"
          checked={includeInactive}
          onChange={e => setIncludeInactive(e.target.checked)}
        />
        <label htmlFor="include-inactive">Show inactive</label>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40">
              <tr className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <th className="text-left p-3">Name</th>
                <th className="text-left p-3">Code</th>
                <th className="text-left p-3">Status</th>
                <th className="text-right p-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {items.map(c => (
                <tr key={c.id} className="border-b last:border-b-0 align-top hover:bg-muted/30">
                  {editing === c.id ? (
                    <>
                      <td className="p-3" colSpan={4}>
                        <form className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end" onSubmit={submitEdit}>
                          <div>
                            <Label>Name</Label>
                            <Input required value={editForm.name}
                              onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} />
                          </div>
                          <div>
                            <Label>Code</Label>
                            <Input value={editForm.code}
                              onChange={e => setEditForm(f => ({ ...f, code: e.target.value }))} />
                          </div>
                          <div className="flex gap-2">
                            <Button type="submit" size="sm" disabled={editBusy}>
                              {editBusy ? 'Saving…' : 'Save'}
                            </Button>
                            <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(null)}>
                              Cancel
                            </Button>
                          </div>
                          {editErr && <p className="text-sm text-destructive md:col-span-4">{editErr}</p>}
                        </form>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="p-3 font-medium">{c.name}</td>
                      <td className="p-3 font-mono">{c.code ?? <span className="text-muted-foreground">—</span>}</td>
                      <td className="p-3">{statusBadge(c.is_active)}</td>
                      <td className="p-3 text-right space-x-2">
                        {canEdit && (
                          <>
                            <Button variant="outline" size="sm" onClick={() => startEdit(c)}>Edit</Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => toggleActive(c)}
                            >
                              {c.is_active ? 'Deactivate' : 'Activate'}
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => softDelete(c.id)}>
                              Delete
                            </Button>
                          </>
                        )}
                      </td>
                    </>
                  )}
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td className="p-6 text-center text-muted-foreground" colSpan={4}>
                    No cost centers yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
