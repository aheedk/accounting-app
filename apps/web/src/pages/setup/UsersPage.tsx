import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/apiClient';
import { useAuth } from '@/auth/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FileDown, Printer } from 'lucide-react';
import { downloadAsExcel } from '@/lib/download';
import { AppSelect } from '../../components/ui/select';
import { printReport } from '@/lib/reportExport';
import { ROLE_LABELS } from '@accounting/shared';

type Role = 'firm_admin' | 'accountant' | 'staff' | 'viewer' | 'client';
const ROLES: Role[] = ['firm_admin', 'accountant', 'staff', 'viewer', 'client'];

type BusinessAccess = {
  business_id: string;
  business_name: string;
  role_override: Role | null;
};

type UserRow = {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  last_login_at: string | null;
  created_at: string;
  // A login that is switched off stays listed, so it can be switched back on.
  deactivated_at: string | null;
  // Held after too many wrong passwords; a new password lifts it.
  locked: boolean;
  two_step_enabled: boolean;
  business_access: BusinessAccess[];
};

type BusinessOption = { id: string; name: string };

type CreatedUser = {
  user: { id: string; email: string; full_name: string; role: Role };
  plaintext_password: string;
};

function errorMessage(e: unknown): string {
  return (e as { response?: { data?: { error?: { message?: string } } } } | undefined)
    ?.response?.data?.error?.message ?? 'Request failed';
}

export default function UsersPage() {
  const { user } = useAuth();
  const canManage = user?.role === 'firm_admin';

  const [users, setUsers] = useState<UserRow[]>([]);
  const [businesses, setBusinesses] = useState<BusinessOption[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const [showInvite, setShowInvite] = useState(false);
  const [invite, setInvite] = useState<{ email: string; full_name: string; role: Role }>(
    { email: '', full_name: '', role: 'staff' },
  );
  const [inviteErr, setInviteErr] = useState<string | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [createdUser, setCreatedUser] = useState<CreatedUser | null>(null);
  // A new password made for an existing login, shown once.
  const [resetResult, setResetResult] = useState<{ email: string; password: string } | null>(null);

  const [grantFor, setGrantFor] = useState<string | null>(null);
  const [grantForm, setGrantForm] = useState<{ business_id: string; role_override: '' | Role }>({
    business_id: '', role_override: '',
  });
  const [grantBusy, setGrantBusy] = useState(false);
  const [grantErr, setGrantErr] = useState<string | null>(null);
  const [excelBusy, setExcelBusy] = useState(false);

  const reload = useCallback(async () => {
    setErr(null);
    try {
      const [u, b] = await Promise.all([
        api.get<{ users: UserRow[] }>('/me/firm/users'),
        api.get<{ businesses?: BusinessOption[] }>('/me'),
      ]);
      setUsers(u.data.users);
      const bizList = Array.isArray(b.data.businesses)
        ? b.data.businesses.map(x => ({ id: x.id, name: x.name }))
        : [];
      setBusinesses(bizList);
    } catch (e) {
      setErr(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    if (!canManage) return;
    void reload();
  }, [canManage, reload]);

  async function submitInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteErr(null);
    setInviteBusy(true);
    try {
      const r = await api.post<CreatedUser>('/me/firm/users', invite);
      setCreatedUser(r.data);
      setShowInvite(false);
      setInvite({ email: '', full_name: '', role: 'staff' });
      await reload();
    } catch (e) {
      setInviteErr(errorMessage(e));
    } finally {
      setInviteBusy(false);
    }
  }

  // Switch a login off or on, give it a new password, sign it out, or turn off its second step.
  async function userAction(u: UserRow, action: 'deactivate' | 'reactivate' | 'reset-password' | 'sign-out' | 'reset-two-step', confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setErr(null);
    try {
      const r = await api.post<{ plaintext_password?: string }>(`/me/firm/users/${u.id}/${action}`);
      if (action === 'reset-password' && r.data.plaintext_password) {
        setResetResult({ email: u.email, password: r.data.plaintext_password });
      }
      await reload();
    } catch (e) {
      setErr(errorMessage(e));
    }
  }

  async function changeRole(user_id: string, role: Role) {
    try {
      await api.patch(`/me/firm/users/${user_id}`, { role });
      await reload();
    } catch (e) {
      setErr(errorMessage(e));
    }
  }

  function openGrant(user_id: string) {
    setGrantErr(null);
    setGrantFor(user_id);
    setGrantForm({ business_id: '', role_override: '' });
  }

  async function submitGrant(e: React.FormEvent) {
    e.preventDefault();
    if (!grantFor || !grantForm.business_id) return;
    setGrantErr(null);
    setGrantBusy(true);
    try {
      await api.post(`/me/firm/users/${grantFor}/business-access`, {
        business_id: grantForm.business_id,
        role_override: grantForm.role_override === '' ? null : grantForm.role_override,
      });
      setGrantFor(null);
      await reload();
    } catch (e) {
      setGrantErr(errorMessage(e));
    } finally {
      setGrantBusy(false);
    }
  }

  async function revoke(user_id: string, business_id: string) {
    try {
      await api.delete(`/me/firm/users/${user_id}/business-access/${business_id}`);
      await reload();
    } catch (e) {
      setErr(errorMessage(e));
    }
  }

  if (!canManage) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">Users</h1>
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            Only firm admins can manage users.
          </CardContent>
        </Card>
      </div>
    );
  }

  const availableBusinessesFor = (u: UserRow) => {
    const existing = new Set(u.business_access.map(a => a.business_id));
    return businesses.filter(b => !existing.has(b.id));
  };

  const dlHeaders = ['Email', 'Name', 'Firm Role', 'Business Access'];
  const dlRows = () => users.map(u => [u.email, u.full_name, u.role, u.business_access?.map((b: BusinessAccess) => b.business_name).join(', ') ?? '']);

  function handleExport() {
    setExcelBusy(true);
    try { downloadAsExcel(dlHeaders, dlRows(), 'users', { title: 'Users' }); } finally { setExcelBusy(false); }
  }

  function handlePrint() {
    printReport({ title: 'Users', headers: dlHeaders, rows: dlRows() });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Users</h1>
          <p className="text-sm text-muted-foreground">
            Invite team members, assign firm-level roles, and grant access to specific businesses.
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
          <Button onClick={() => setShowInvite(s => !s)}>
            {showInvite ? 'Cancel' : 'Invite user'}
          </Button>
        </div>
      </div>

      {err && <p className="text-sm text-destructive">{err}</p>}

      {createdUser && (
        <Card className="border-emerald-500/40">
          <CardHeader>
            <CardTitle className="text-emerald-700">User created</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>
              <strong>{createdUser.user.email}</strong> was created. Share the temporary
              password below now — it will not be shown again.
            </p>
            <div className="rounded-md bg-muted p-3 font-mono text-sm break-all">
              {createdUser.plaintext_password}
            </div>
            <div>
              <Button variant="outline" size="sm" onClick={() => setCreatedUser(null)}>Dismiss</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {resetResult && (
        <Card className="border-emerald-500/40">
          <CardHeader>
            <CardTitle className="text-emerald-700">New password</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>
              <strong>{resetResult.email}</strong> has a new password and was signed out everywhere.
              Pass it on now — it will not be shown again. They can change it under My account.
            </p>
            <div className="rounded-md bg-muted p-3 font-mono text-sm break-all">{resetResult.password}</div>
            <div>
              <Button variant="outline" size="sm" onClick={() => setResetResult(null)}>Dismiss</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {showInvite && (
        <Card>
          <CardHeader><CardTitle>Invite user</CardTitle></CardHeader>
          <CardContent>
            <form className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end" onSubmit={submitInvite}>
              <div>
                <Label>Email</Label>
                <Input type="email" required value={invite.email}
                  onChange={e => setInvite(i => ({ ...i, email: e.target.value }))} />
              </div>
              <div>
                <Label>Full name</Label>
                <Input required value={invite.full_name}
                  onChange={e => setInvite(i => ({ ...i, full_name: e.target.value }))} />
              </div>
              <div>
                <Label>Firm-level role</Label>
                <AppSelect
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={invite.role}
                  onChange={e => setInvite(i => ({ ...i, role: e.target.value as Role }))}
                >
                  {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </AppSelect>
              </div>
              {inviteErr && <p className="text-sm text-destructive md:col-span-3">{inviteErr}</p>}
              <div className="md:col-span-3">
                <Button type="submit" disabled={inviteBusy}>
                  {inviteBusy ? 'Creating…' : 'Create user'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40">
              <tr className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <th className="text-left p-3">Email</th>
                <th className="text-left p-3">Name</th>
                <th className="text-left p-3">Firm role</th>
                <th className="text-left p-3">Business access</th>
                <th className="text-right p-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => {
                const isSelf = u.id === user?.id;
                return (
                  <tr key={u.id} className="border-b last:border-b-0 align-top hover:bg-muted/30">
                    <td className="p-3">{u.email}</td>
                    <td className="p-3">
                      {u.full_name}
                      <div className="mt-1 flex flex-wrap gap-1">
                        {u.deactivated_at && <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-800">Switched off</span>}
                        {u.locked && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800" title="Too many wrong passwords. A new password lifts it.">Held</span>}
                        {u.two_step_enabled && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">Two-step</span>}
                      </div>
                    </td>
                    <td className="p-3">
                      <AppSelect
                        className="h-9 rounded-md border bg-background px-2 text-sm disabled:opacity-50"
                        value={u.role}
                        disabled={isSelf}
                        onChange={e => changeRole(u.id, e.target.value as Role)}
                      >
                        {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                      </AppSelect>
                      {isSelf && <p className="text-xs text-muted-foreground mt-1">(you)</p>}
                    </td>
                    <td className="p-3">
                      <ul className="space-y-1">
                        {u.business_access.length === 0 && (
                          <li className="text-xs text-muted-foreground">
                            {u.role === 'firm_admin' ? 'All businesses (firm admin)' : 'None'}
                          </li>
                        )}
                        {u.business_access.map(a => (
                          <li key={a.business_id} className="flex items-center gap-2">
                            <span>{a.business_name}</span>
                            {a.role_override && (
                              <span className="text-xs rounded-full border px-2 py-0.5">
                                as {ROLE_LABELS[a.role_override]}
                              </span>
                            )}
                            <button
                              type="button"
                              className="text-xs text-destructive hover:underline"
                              onClick={() => revoke(u.id, a.business_id)}
                            >
                              revoke
                            </button>
                          </li>
                        ))}
                      </ul>
                      {grantFor === u.id && (
                        <form className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-2 items-end" onSubmit={submitGrant}>
                          <div>
                            <Label className="text-xs">Business</Label>
                            <AppSelect
                              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                              value={grantForm.business_id}
                              onChange={e => setGrantForm(g => ({ ...g, business_id: e.target.value }))}
                              required
                            >
                              <option value="">Select…</option>
                              {availableBusinessesFor(u).map(b => (
                                <option key={b.id} value={b.id}>{b.name}</option>
                              ))}
                            </AppSelect>
                          </div>
                          <div>
                            <Label className="text-xs">Role override (optional)</Label>
                            <AppSelect
                              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                              value={grantForm.role_override}
                              onChange={e => setGrantForm(g => ({ ...g, role_override: e.target.value as '' | Role }))}
                            >
                              <option value="">(no override)</option>
                              {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                            </AppSelect>
                          </div>
                          <div className="flex gap-2">
                            <Button type="submit" size="sm" disabled={grantBusy}>
                              {grantBusy ? 'Granting…' : 'Grant'}
                            </Button>
                            <Button type="button" variant="ghost" size="sm" onClick={() => setGrantFor(null)}>
                              Cancel
                            </Button>
                          </div>
                          {grantErr && <p className="text-xs text-destructive md:col-span-3">{grantErr}</p>}
                        </form>
                      )}
                    </td>
                    <td className="p-3 text-right">
                      {grantFor !== u.id && (
                        <Button variant="outline" size="sm" onClick={() => openGrant(u.id)}>
                          Grant access
                        </Button>
                      )}
                      <div className="mt-2 flex flex-col items-end gap-1 text-xs">
                        <button type="button" className="text-primary hover:underline" onClick={() => void userAction(u, 'reset-password', `Give ${u.email} a new password? They will be signed out everywhere.`)}>Reset password</button>
                        {!isSelf && <button type="button" className="text-primary hover:underline" onClick={() => void userAction(u, 'sign-out')}>Sign out everywhere</button>}
                        {u.two_step_enabled && <button type="button" className="text-primary hover:underline" onClick={() => void userAction(u, 'reset-two-step', `Turn off the second step for ${u.email}? Do this when they have lost the phone it is on.`)}>Turn off two-step</button>}
                        {!isSelf && (u.deactivated_at
                          ? <button type="button" className="text-primary hover:underline" onClick={() => void userAction(u, 'reactivate')}>Switch back on</button>
                          : <button type="button" className="text-destructive hover:underline" onClick={() => void userAction(u, 'deactivate', `Switch off ${u.email}? They are signed out now and cannot sign in until it is switched back on.`)}>Switch off</button>)}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {users.length === 0 && (
                <tr>
                  <td className="p-6 text-center text-muted-foreground" colSpan={5}>
                    No users yet.
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
