import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, MoreHorizontal, Search } from 'lucide-react';
import { api } from '@/lib/apiClient';
import { useAuth } from '@/auth/useAuth';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { AppSelect } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ROLE_LABELS } from '@accounting/shared';
import { type Role, type CustomRoleRef, builtin, roleChoice, RoleOptions } from './userRoleOptions';

// Setup → Users → "Edit client access": the full-page view of which
// businesses one login can open, and what role it has in each — QBO's own
// "Edit user access to clients" page is the reference. One business at a
// time, saved immediately, rather than a staged batch of changes: every
// other admin form in this app already works that way.

type BusinessAccess = {
  business_id: string;
  business_name: string;
  role_override: Role | null;
  custom_role: CustomRoleRef | null;
};

type UserRow = {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  custom_role: CustomRoleRef | null;
  business_access: BusinessAccess[];
};

type BusinessOption = { id: string; name: string };

function errorMessage(e: unknown): string {
  return (e as { response?: { data?: { error?: { message?: string } } } } | undefined)
    ?.response?.data?.error?.message ?? 'Request failed';
}

export default function UserAccessPage() {
  const { userId } = useParams<{ userId: string }>();
  const { user } = useAuth();
  const nav = useNavigate();
  const [, setActiveBusiness] = useActiveBusinessId();
  const canManage = user?.role === 'firm_admin';

  const [loaded, setLoaded] = useState(false);
  const [target, setTarget] = useState<UserRow | null>(null);
  const [customRoles, setCustomRoles] = useState<CustomRoleRef[]>([]);
  const [businesses, setBusinesses] = useState<BusinessOption[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [searchText, setSearchText] = useState('');

  // Which business's role form is open, and its own state.
  const [editingBizId, setEditingBizId] = useState<string | null>(null);
  const [roleChoiceValue, setRoleChoiceValue] = useState('');
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [rowErr, setRowErr] = useState<string | null>(null);

  // Checked rows, for "Revoke access" or "Assign a role" on several at once.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkRoleValue, setBulkRoleValue] = useState('');

  const reload = useCallback(async () => {
    setErr(null);
    try {
      const [u, b, r] = await Promise.all([
        api.get<{ users: UserRow[] }>('/me/firm/users'),
        api.get<{ businesses?: BusinessOption[] }>('/me'),
        api.get<{ roles: CustomRoleRef[] }>('/me/firm/roles'),
      ]);
      setTarget(u.data.users.find(x => x.id === userId) ?? null);
      setBusinesses(Array.isArray(b.data.businesses) ? b.data.businesses.map(x => ({ id: x.id, name: x.name })) : []);
      setCustomRoles(r.data.roles.map(role => ({ id: role.id, name: role.name })));
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setLoaded(true);
    }
  }, [userId]);

  useEffect(() => { if (canManage) void reload(); }, [canManage, reload]);

  const filteredBusinesses = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return q ? businesses.filter(b => b.name.toLowerCase().includes(q)) : businesses;
  }, [businesses, searchText]);

  const grantFor = (businessId: string) => target?.business_access.find(a => a.business_id === businessId) ?? null;

  function startEdit(businessId: string, grant: BusinessAccess | null) {
    setRowErr(null);
    setEditingBizId(businessId);
    setRoleChoiceValue(grant ? (grant.custom_role ? `custom:${grant.custom_role.id}` : grant.role_override ? builtin(grant.role_override) : '') : '');
  }

  function accessBody(value: string) {
    const choice = value === '' ? null : roleChoice(value);
    return {
      role_override: choice && 'role' in choice ? choice.role : null,
      custom_role_id: choice && 'custom_role_id' in choice ? choice.custom_role_id : null,
    };
  }

  async function setAccess(businessId: string, value: string) {
    if (!target) return;
    const body = accessBody(value);
    if (grantFor(businessId)) {
      await api.patch(`/me/firm/users/${target.id}/business-access/${businessId}`, body);
    } else {
      await api.post(`/me/firm/users/${target.id}/business-access`, { business_id: businessId, ...body });
    }
  }

  async function saveEdit(businessId: string) {
    setRowBusy(businessId);
    setRowErr(null);
    try {
      await setAccess(businessId, roleChoiceValue);
      setEditingBizId(null);
      await reload();
    } catch (e) {
      setRowErr(errorMessage(e));
    } finally {
      setRowBusy(null);
    }
  }

  async function assignSelected() {
    if (!target || selected.size === 0) return;
    setBulkBusy(true);
    setErr(null);
    try {
      for (const id of selected) await setAccess(id, bulkRoleValue);
      setSelected(new Set());
      setBulkRoleValue('');
      await reload();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBulkBusy(false);
    }
  }

  async function revoke(businessId: string, businessName: string) {
    if (!target) return;
    if (!window.confirm(`Revoke ${target.full_name}'s access to ${businessName}?`)) return;
    setRowBusy(businessId);
    setErr(null);
    try {
      await api.delete(`/me/firm/users/${target.id}/business-access/${businessId}`);
      await reload();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setRowBusy(null);
    }
  }

  async function revokeSelected() {
    if (!target) return;
    const grantedIds = [...selected].filter(id => grantFor(id));
    if (grantedIds.length === 0) { setSelected(new Set()); return; }
    if (!window.confirm(`Revoke access to ${grantedIds.length} ${grantedIds.length === 1 ? 'client' : 'clients'}?`)) return;
    setBulkBusy(true);
    setErr(null);
    try {
      for (const id of grantedIds) await api.delete(`/me/firm/users/${target.id}/business-access/${id}`);
      setSelected(new Set());
      await reload();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBulkBusy(false);
    }
  }

  function toggleSelected(id: string) {
    setSelected(cur => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  if (!canManage) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">Edit client access</h1>
        <Card><CardContent className="py-6 text-sm text-muted-foreground">Only firm admins can manage users.</CardContent></Card>
      </div>
    );
  }

  if (loaded && !target) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">User not found</h1>
        <Link to="/setup/users" className="text-sm text-link hover:underline">← Back to Users</Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link to="/setup/users" className="inline-flex items-center gap-1 text-sm text-link hover:underline">
          <ChevronLeft className="h-4 w-4" /> Back to Users
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">
          {target ? `${target.full_name}'s access to clients` : 'Edit client access'}
        </h1>
        {target && <p className="text-sm text-muted-foreground">{target.email} · {target.custom_role?.name ?? ROLE_LABELS[target.role]}</p>}
      </div>

      {err && <p className="text-sm text-destructive">{err}</p>}

      {target?.role === 'firm_admin' ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            Firm admins have access to every business automatically — there is nothing to grant or revoke here.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <div className="relative w-64">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="h-9 pl-8" placeholder="Search clients" value={searchText} onChange={e => setSearchText(e.target.value)} />
            </div>
            {selected.size > 0 && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">{selected.size} selected</span>
                <AppSelect className="h-9 w-44 rounded-md border bg-background px-2 text-sm" value={bulkRoleValue} onChange={e => setBulkRoleValue(e.target.value)}>
                  <option value="">Their own role</option>
                  <RoleOptions roles={customRoles} />
                </AppSelect>
                <Button size="sm" disabled={bulkBusy} onClick={() => void assignSelected()}>
                  {bulkBusy ? 'Assigning…' : 'Assign to selected'}
                </Button>
                <Button variant="outline" size="sm" className="text-destructive" disabled={bulkBusy} onClick={() => void revokeSelected()}>
                  {bulkBusy ? 'Revoking…' : 'Revoke access'}
                </Button>
              </div>
            )}
          </div>

          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40">
                  <tr className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <th className="p-3 w-10">
                      <input
                        type="checkbox"
                        aria-label="Select all clients"
                        checked={filteredBusinesses.length > 0 && filteredBusinesses.every(b => selected.has(b.id))}
                        onChange={e => setSelected(e.target.checked ? new Set(filteredBusinesses.map(b => b.id)) : new Set())}
                      />
                    </th>
                    <th className="text-left p-3">Client</th>
                    <th className="text-left p-3">Role</th>
                    <th className="text-left p-3">Status</th>
                    <th className="text-right p-3">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredBusinesses.map(b => {
                    const grant = grantFor(b.id);
                    const busy = rowBusy === b.id;
                    const roleLabel = grant
                      ? grant.custom_role?.name ?? (grant.role_override ? ROLE_LABELS[grant.role_override] : `Their own role (${target ? ROLE_LABELS[target.role] : ''})`)
                      : '—';
                    return (
                      <tr key={b.id} className="border-b last:border-b-0 align-top hover:bg-muted/30">
                        <td className="p-3">
                          <input type="checkbox" aria-label={`Select ${b.name}`} checked={selected.has(b.id)} onChange={() => toggleSelected(b.id)} />
                        </td>
                        <td className="p-3">{b.name}</td>
                        <td className="p-3">{roleLabel}</td>
                        <td className="p-3">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${grant ? 'bg-emerald-100 text-emerald-800' : 'bg-muted text-muted-foreground'}`}>
                            {grant ? 'Active' : 'No access'}
                          </span>
                        </td>
                        <td className="p-3 text-right">
                          {editingBizId === b.id ? (
                            <div className="flex items-center justify-end gap-2">
                              <Label className="sr-only">Role</Label>
                              <AppSelect
                                className="h-9 w-48 rounded-md border bg-background px-2 text-sm"
                                value={roleChoiceValue}
                                onChange={e => setRoleChoiceValue(e.target.value)}
                              >
                                <option value="">Their own role</option>
                                <RoleOptions roles={customRoles} />
                              </AppSelect>
                              <Button size="sm" disabled={busy} onClick={() => void saveEdit(b.id)}>{busy ? 'Saving…' : 'Save'}</Button>
                              <Button size="sm" variant="ghost" onClick={() => setEditingBizId(null)}>Cancel</Button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-end gap-2 text-xs">
                              <button type="button" className="text-link hover:underline" onClick={() => startEdit(b.id, grant)}>Edit</button>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <button type="button" aria-label="More actions" disabled={busy} className="text-muted-foreground hover:text-foreground disabled:opacity-50">
                                    <MoreHorizontal className="h-4 w-4" />
                                  </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent>
                                  <DropdownMenuItem onSelect={() => { setActiveBusiness(b.id); nav('/'); }}>
                                    View client details
                                  </DropdownMenuItem>
                                  <DropdownMenuItem disabled={!grant} className="text-destructive focus:text-destructive" onSelect={() => void revoke(b.id, b.name)}>
                                    {busy ? 'Revoking…' : 'Revoke access'}
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          )}
                          {rowErr && editingBizId === b.id && <p className="mt-1 text-xs text-destructive">{rowErr}</p>}
                        </td>
                      </tr>
                    );
                  })}
                  {filteredBusinesses.length === 0 && (
                    <tr><td className="p-6 text-center text-muted-foreground" colSpan={5}>No clients match the search.</td></tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}

      <div>
        <Button variant="outline" onClick={() => nav('/setup/users')}>Done</Button>
      </div>
    </div>
  );
}
