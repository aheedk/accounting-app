import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/apiClient';
import { useAuth } from '@/auth/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DownloadButtons } from '@/components/ui/DownloadButtons';

type Role = 'firm_admin' | 'accountant' | 'staff' | 'client';
const ROLES: Role[] = ['firm_admin', 'accountant', 'staff', 'client'];

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

  const [grantFor, setGrantFor] = useState<string | null>(null);
  const [grantForm, setGrantForm] = useState<{ business_id: string; role_override: '' | Role }>({
    business_id: '', role_override: '',
  });
  const [grantBusy, setGrantBusy] = useState(false);
  const [grantErr, setGrantErr] = useState<string | null>(null);

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
          <DownloadButtons
            headers={['Email', 'Name', 'Firm Role', 'Business Access']}
            getRows={() => users.map(u => [u.email, u.full_name, u.role, u.business_access?.map((b: BusinessAccess) => b.business_name).join(', ') ?? ''])}
            filename="users"
            title="Users"
          />
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
                <select
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={invite.role}
                  onChange={e => setInvite(i => ({ ...i, role: e.target.value as Role }))}
                >
                  {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
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
              <tr>
                <th className="text-left p-3">Email</th>
                <th className="text-left p-3">Name</th>
                <th className="text-left p-3">Firm role</th>
                <th className="text-left p-3">Business access</th>
                <th className="text-right p-3"></th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => {
                const isSelf = u.id === user?.id;
                return (
                  <tr key={u.id} className="border-b last:border-b-0 align-top">
                    <td className="p-3">{u.email}</td>
                    <td className="p-3">{u.full_name}</td>
                    <td className="p-3">
                      <select
                        className="h-9 rounded-md border bg-background px-2 text-sm disabled:opacity-50"
                        value={u.role}
                        disabled={isSelf}
                        onChange={e => changeRole(u.id, e.target.value as Role)}
                      >
                        {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
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
                                as {a.role_override}
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
                            <select
                              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                              value={grantForm.business_id}
                              onChange={e => setGrantForm(g => ({ ...g, business_id: e.target.value }))}
                              required
                            >
                              <option value="">Select…</option>
                              {availableBusinessesFor(u).map(b => (
                                <option key={b.id} value={b.id}>{b.name}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <Label className="text-xs">Role override (optional)</Label>
                            <select
                              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                              value={grantForm.role_override}
                              onChange={e => setGrantForm(g => ({ ...g, role_override: e.target.value as '' | Role }))}
                            >
                              <option value="">(no override)</option>
                              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                            </select>
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
