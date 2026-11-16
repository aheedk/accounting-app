import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useAuth } from '@/auth/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FileDown, Printer, Search, ChevronDown } from 'lucide-react';
import { downloadAsExcel } from '@/lib/download';
import { AppSelect } from '../../components/ui/select';
import { printReport } from '@/lib/reportExport';
import { ROLE_LABELS } from '@accounting/shared';
import { FirmSignInSettings } from '@/components/account/FirmSignInSettings';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

type Role = 'firm_admin' | 'accountant' | 'staff' | 'viewer' | 'client';
const ROLES: Role[] = ['firm_admin', 'accountant', 'staff', 'viewer', 'client'];

/** One of the firm's own roles (Setup → Roles, docs/specs/2026-11-09-custom-roles-design.md). */
type CustomRoleRef = { id: string; name: string };

type BusinessAccess = {
  business_id: string;
  business_name: string;
  role_override: Role | null;
  custom_role: CustomRoleRef | null;
};

// A role menu's value: `builtin:staff`, or `custom:<role id>`.
const builtin = (role: Role) => `builtin:${role}`;
const custom = (id: string) => `custom:${id}`;
function roleChoice(value: string): { role: Role } | { custom_role_id: string } {
  return value.startsWith('custom:') ? { custom_role_id: value.slice('custom:'.length) } : { role: value.slice('builtin:'.length) as Role };
}

/** The built-in roles, then the firm's own. */
function RoleOptions({ roles }: { roles: CustomRoleRef[] }) {
  return (
    <>
      <optgroup label="Built-in roles">
        {ROLES.map(r => <option key={r} value={builtin(r)}>{ROLE_LABELS[r]}</option>)}
      </optgroup>
      {roles.length > 0 && (
        <optgroup label="Your roles">
          {roles.map(r => <option key={r.id} value={custom(r.id)}>{r.name}</option>)}
        </optgroup>
      )}
    </>
  );
}

type UserRow = {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  /** One of the firm's own roles; `role` is then staff. */
  custom_role: CustomRoleRef | null;
  last_login_at: string | null;
  created_at: string;
  // A login that is switched off stays listed, so it can be switched back on.
  deactivated_at: string | null;
  // Held after too many wrong passwords; a new password lifts it.
  locked: boolean;
  two_step_enabled: boolean;
  // Whether this login may open payroll. Always true for a firm admin.
  payroll_access: boolean;
  business_access: BusinessAccess[];
  /** An emailed invitation link in place of an admin-typed password. */
  invitation_status: 'pending' | 'sent' | 'accepted';
  invitation_expires_at: string | null;
};

type BusinessOption = { id: string; name: string };

type CreatedUser = {
  user: { id: string; email: string; full_name: string; role: Role };
  email_sent: boolean;
};

type StatusKey = 'active' | 'invited' | 'expired' | 'deactivated';

/** One status per login: Deactivated beats a pending invitation, which beats
 * Active. "Expired" is computed from the expiry, not a stored value — see
 * the design spec's note on why. */
function userStatus(u: UserRow): { key: StatusKey; label: string; className: string } {
  if (u.deactivated_at) return { key: 'deactivated', label: 'Deactivated', className: 'bg-rose-100 text-rose-800' };
  if (u.invitation_status !== 'accepted') {
    const expired = !u.invitation_expires_at || new Date(u.invitation_expires_at).getTime() < Date.now();
    return expired
      ? { key: 'expired', label: 'Expired', className: 'bg-muted text-muted-foreground' }
      : { key: 'invited', label: 'Invited', className: 'bg-amber-100 text-amber-800' };
  }
  return { key: 'active', label: 'Active', className: 'bg-emerald-100 text-emerald-800' };
}

const STATUS_FILTERS: Array<{ key: StatusKey | 'all'; label: string }> = [
  { key: 'all', label: 'All statuses' },
  { key: 'active', label: 'Active' },
  { key: 'invited', label: 'Invited' },
  { key: 'expired', label: 'Expired' },
  { key: 'deactivated', label: 'Deactivated' },
];

/** The comma list a business-access cell shows collapsed: the firm admin's
 * implicit "everything", "None", or the first two names plus a "+N more" count. */
function businessAccessSummary(u: UserRow): string {
  if (u.role === 'firm_admin') return 'All businesses';
  if (u.business_access.length === 0) return 'None';
  const names = u.business_access.map(a => a.business_name);
  return names.length <= 2 ? names.join(', ') : `${names.slice(0, 2).join(', ')} +${names.length - 2} more`;
}

function errorMessage(e: unknown): string {
  return (e as { response?: { data?: { error?: { message?: string } } } } | undefined)
    ?.response?.data?.error?.message ?? 'Request failed';
}

export default function UsersPage() {
  const { user } = useAuth();
  const canManage = user?.role === 'firm_admin';

  const [users, setUsers] = useState<UserRow[]>([]);
  const [customRoles, setCustomRoles] = useState<CustomRoleRef[]>([]);
  const [businesses, setBusinesses] = useState<BusinessOption[]>([]);
  const [err, setErr] = useState<string | null>(null);
  // Which row action is in flight, and a brief result message next to it
  // (green on success, red on failure) — fades on its own after a few seconds.
  const [rowBusy, setRowBusy] = useState<{ id: string; action: string } | null>(null);
  const [rowFlash, setRowFlash] = useState<{ id: string; text: string; tone: 'success' | 'error' } | null>(null);

  // Search by name or email, and filter by role or status — all client-side
  // over the one page of users a firm realistically has.
  const [searchText, setSearchText] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<StatusKey | 'all'>('all');

  const [showInvite, setShowInvite] = useState(false);
  const [invite, setInvite] = useState<{ email: string; full_name: string; access: string }>(
    { email: '', full_name: '', access: builtin('staff') },
  );
  const [inviteErr, setInviteErr] = useState<string | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [createdUser, setCreatedUser] = useState<CreatedUser | null>(null);
  // A new password made for an existing login, shown once.
  const [resetResult, setResetResult] = useState<{ email: string; password: string } | null>(null);

  // The "Edit user" dropdown item: renames a login in place. The email is not
  // editable here — see userManagementService.updateUserProfile.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const [editErr, setEditErr] = useState<string | null>(null);

  // Which row's business-access detail (the full list, revoke links, the
  // grant form) is expanded — collapsed by default so the column stays compact.
  const [expandedAccess, setExpandedAccess] = useState<string | null>(null);
  const [grantFor, setGrantFor] = useState<string | null>(null);
  // `access` is '' (the login's own role applies there) or a role menu value.
  const [grantForm, setGrantForm] = useState<{ business_id: string; access: string }>({
    business_id: '', access: '',
  });
  const [grantBusy, setGrantBusy] = useState(false);
  const [grantErr, setGrantErr] = useState<string | null>(null);
  const [excelBusy, setExcelBusy] = useState(false);

  const reload = useCallback(async () => {
    setErr(null);
    try {
      const [u, b, r] = await Promise.all([
        api.get<{ users: UserRow[] }>('/me/firm/users'),
        api.get<{ businesses?: BusinessOption[] }>('/me'),
        api.get<{ roles: CustomRoleRef[] }>('/me/firm/roles'),
      ]);
      setUsers(u.data.users);
      setCustomRoles(r.data.roles.map(role => ({ id: role.id, name: role.name })));
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
      const choice = roleChoice(invite.access);
      const r = await api.post<CreatedUser>('/me/firm/users', {
        email: invite.email, full_name: invite.full_name,
        ...('role' in choice ? { role: choice.role } : { role: 'staff', custom_role_id: choice.custom_role_id }),
      });
      setCreatedUser(r.data);
      setShowInvite(false);
      setInvite({ email: '', full_name: '', access: builtin('staff') });
      await reload();
    } catch (e) {
      setInviteErr(errorMessage(e));
    } finally {
      setInviteBusy(false);
    }
  }

  type UserActionKind = 'deactivate' | 'reactivate' | 'reset-password' | 'sign-out' | 'reset-two-step' | 'resend-invitation';

  function flashRow(id: string, text: string, tone: 'success' | 'error') {
    setRowFlash({ id, text, tone });
    setTimeout(() => setRowFlash(cur => (cur?.id === id && cur.text === text ? null : cur)), 3000);
  }

  // Switch a login off or on, give it a new password, sign it out, turn off
  // its second step, or resend its invitation. `successText`, when given, is
  // what flashes next to the link once the action actually succeeds.
  async function userAction(u: UserRow, action: UserActionKind, confirmText?: string, successText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setErr(null);
    setRowBusy({ id: u.id, action });
    try {
      const r = await api.post<{ plaintext_password?: string; email_sent?: boolean }>(`/me/firm/users/${u.id}/${action}`);
      if (action === 'reset-password' && r.data.plaintext_password) {
        setResetResult({ email: u.email, password: r.data.plaintext_password });
      }
      if (action === 'resend-invitation' && r.data.email_sent === false) {
        flashRow(u.id, "Issued a fresh link, but the email couldn't be sent.", 'error');
      } else if (successText) {
        flashRow(u.id, successText, 'success');
      }
      await reload();
    } catch (e) {
      flashRow(u.id, errorMessage(e), 'error');
    } finally {
      setRowBusy(null);
    }
  }

  async function deleteUserRow(u: UserRow) {
    if (!window.confirm(`Permanently delete ${u.full_name}? This cannot be undone.`)) return;
    setErr(null);
    setRowBusy({ id: u.id, action: 'delete' });
    try {
      await api.delete(`/me/firm/users/${u.id}`);
      await reload();
    } catch (e) {
      flashRow(u.id, errorMessage(e), 'error');
    } finally {
      setRowBusy(null);
    }
  }

  function startEdit(u: UserRow) {
    setEditingId(u.id);
    setEditName(u.full_name);
    setEditErr(null);
  }

  async function saveEdit(u: UserRow) {
    const full_name = editName.trim();
    if (!full_name) { setEditErr('Enter a name.'); return; }
    setEditBusy(true);
    setEditErr(null);
    try {
      await api.patch(`/me/firm/users/${u.id}/profile`, { full_name });
      setEditingId(null);
      await reload();
    } catch (e) {
      setEditErr(errorMessage(e));
    } finally {
      setEditBusy(false);
    }
  }

  async function setPayroll(u: UserRow, allowed: boolean) {
    setErr(null);
    try {
      await api.post(`/me/firm/users/${u.id}/payroll-access`, { allowed });
      await reload();
    } catch (e) {
      setErr(errorMessage(e));
    }
  }

  async function changeRole(user_id: string, value: string) {
    try {
      await api.patch(`/me/firm/users/${user_id}`, roleChoice(value));
      await reload();
    } catch (e) {
      setErr(errorMessage(e));
    }
  }

  function openGrant(user_id: string) {
    setGrantErr(null);
    setGrantFor(user_id);
    setExpandedAccess(user_id);
    setGrantForm({ business_id: '', access: '' });
  }

  async function submitGrant(e: React.FormEvent) {
    e.preventDefault();
    if (!grantFor || !grantForm.business_id) return;
    setGrantErr(null);
    setGrantBusy(true);
    try {
      const choice = grantForm.access === '' ? null : roleChoice(grantForm.access);
      await api.post(`/me/firm/users/${grantFor}/business-access`, {
        business_id: grantForm.business_id,
        role_override: choice && 'role' in choice ? choice.role : null,
        custom_role_id: choice && 'custom_role_id' in choice ? choice.custom_role_id : null,
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

  const filteredUsers = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return users.filter(u => {
      if (q && !u.full_name.toLowerCase().includes(q) && !u.email.toLowerCase().includes(q)) return false;
      if (roleFilter !== 'all') {
        const matches = u.custom_role ? custom(u.custom_role.id) === roleFilter : builtin(u.role) === roleFilter;
        if (!matches) return false;
      }
      if (statusFilter !== 'all' && userStatus(u).key !== statusFilter) return false;
      return true;
    });
  }, [users, searchText, roleFilter, statusFilter]);

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

  // The API refuses to switch off or delete the firm's only firm admin, so
  // those links are hidden rather than offered and left to fail.
  const isOnlyActiveFirmAdmin = (u: UserRow) =>
    u.role === 'firm_admin' && !u.deactivated_at
    && users.filter(x => x.role === 'firm_admin' && !x.deactivated_at).length <= 1;

  const dlHeaders = ['Email', 'Name', 'Firm Role', 'Business Access'];
  const dlRows = () => users.map(u => [u.email, u.full_name, u.custom_role?.name ?? ROLE_LABELS[u.role], u.business_access?.map((b: BusinessAccess) => b.business_name).join(', ') ?? '']);

  async function handleExport() {
    setExcelBusy(true);
    try { await downloadAsExcel(dlHeaders, dlRows(), 'users', { title: 'Users' }); } finally { setExcelBusy(false); }
  }

  function handlePrint() {
    printReport({ title: 'Users', headers: dlHeaders, rows: dlRows() });
  }

  /** The row's single "Edit user ▾" menu — every other action lives inside it. */
  function actionsMenu(u: UserRow) {
    const isSelf = u.id === user?.id;
    const status = userStatus(u);
    const busyHere = rowBusy?.id === u.id;
    const canResend = status.key === 'invited' || status.key === 'expired';
    const canResetPassword = status.key !== 'deactivated';
    const canSignOut = !isSelf && (status.key === 'active' || status.key === 'deactivated');
    const canSwitchOff = !isSelf && !isOnlyActiveFirmAdmin(u);
    const canDelete = !isSelf && !isOnlyActiveFirmAdmin(u);

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={busyHere}
            className="inline-flex items-center gap-1 text-link hover:underline disabled:cursor-not-allowed disabled:opacity-50"
          >
            Edit user <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={() => startEdit(u)}>Edit user</DropdownMenuItem>
          {u.role !== 'firm_admin' && <DropdownMenuItem onSelect={() => openGrant(u.id)}>Grant access</DropdownMenuItem>}
          {canResend && (
            <DropdownMenuItem onSelect={() => void userAction(u, 'resend-invitation', `Resend the invitation to ${u.email}?`, 'Invitation resent')}>
              Resend invitation
            </DropdownMenuItem>
          )}
          {canResetPassword && (
            <DropdownMenuItem onSelect={() => void userAction(u, 'reset-password', `Give ${u.email} a new password? They will be signed out everywhere.`)}>
              Reset password
            </DropdownMenuItem>
          )}
          {canSignOut && (
            <DropdownMenuItem onSelect={() => void userAction(u, 'sign-out', `Sign out ${u.full_name} from all devices? They'll need to sign in again.`, 'Signed out everywhere')}>
              Sign out everywhere
            </DropdownMenuItem>
          )}
          {u.two_step_enabled && (
            <DropdownMenuItem onSelect={() => void userAction(u, 'reset-two-step', `Turn off the second step for ${u.email}? Do this when they have lost the phone it is on.`, 'Second step turned off')}>
              Turn off two-step
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          {!isSelf && (status.key === 'deactivated'
            ? <DropdownMenuItem onSelect={() => void userAction(u, 'reactivate', undefined, 'Switched on')}>Switch on</DropdownMenuItem>
            : canSwitchOff && (
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={() => void userAction(u, 'deactivate', `Deactivate ${u.full_name}? They won't be able to sign in until reactivated.`, 'Switched off')}
              >
                Switch off
              </DropdownMenuItem>
            ))}
          {canDelete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => void deleteUserRow(u)}>
                Delete
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Users</h1>
          <p className="text-sm text-muted-foreground">
            Add logins, give each a role (built-in, or one of <Link to="/setup/roles" className="text-link hover:underline">your own</Link>), and grant access to specific businesses.
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
          <Link to="/setup/roles" className="inline-flex h-9 items-center rounded-md border bg-background px-3 text-sm font-medium hover:bg-accent">
            Roles
          </Link>
          <Button onClick={() => setShowInvite(s => !s)}>
            {showInvite ? 'Cancel' : 'Add user'}
          </Button>
        </div>
      </div>

      {err && <p className="text-sm text-destructive">{err}</p>}

      {createdUser && (
        <Card className={createdUser.email_sent ? 'border-emerald-500/40' : 'border-amber-500/40'}>
          <CardHeader>
            <CardTitle className={createdUser.email_sent ? 'text-emerald-700' : 'text-amber-700'}>
              {createdUser.email_sent ? 'User created' : 'User created, but the email failed'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {createdUser.email_sent ? (
              <p>
                An invitation was emailed to <strong>{createdUser.user.email}</strong>. They
                set up their own password by following its link — nobody here sees it.
              </p>
            ) : (
              <p>
                The login for <strong>{createdUser.user.email}</strong> was created, but the
                invitation email couldn't be sent. Use <strong>Resend invitation</strong> below
                once email is set up, or ask whoever set up the server to check it.
              </p>
            )}
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
              Pass it on now — it will not be shown again. They choose their own the next time they sign in.
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
          <CardHeader><CardTitle>Add user</CardTitle></CardHeader>
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
                <Label>Role</Label>
                <AppSelect
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={invite.access}
                  onChange={e => setInvite(i => ({ ...i, access: e.target.value }))}
                >
                  <RoleOptions roles={customRoles} />
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

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="h-9 w-64 pl-8"
            placeholder="Search by name or email"
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
          />
        </div>
        <AppSelect className="h-9 w-44 rounded-md border bg-background px-2 text-sm" value={roleFilter} onChange={e => setRoleFilter(e.target.value)}>
          <option value="all">All roles</option>
          <RoleOptions roles={customRoles} />
        </AppSelect>
        <AppSelect
          className="h-9 w-40 rounded-md border bg-background px-2 text-sm"
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as StatusKey | 'all')}
        >
          {STATUS_FILTERS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
        </AppSelect>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40">
              <tr className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <th className="text-left p-3 w-[18%]">Name</th>
                <th className="text-left p-3 w-[20%]">Email</th>
                <th className="text-left p-3 w-[12%]">Status</th>
                <th className="text-left p-3 w-[18%]">Role</th>
                <th className="text-left p-3">Business access</th>
                <th className="text-right p-3 w-[10%]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map(u => {
                const isSelf = u.id === user?.id;
                const status = userStatus(u);
                return (
                  <tr key={u.id} className="border-b last:border-b-0 align-top hover:bg-muted/30">
                    <td className="p-3">
                      {editingId === u.id ? (
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5">
                            <Input className="h-8 w-36" value={editName} onChange={e => setEditName(e.target.value)} autoFocus />
                            <Button size="sm" className="h-8 px-2" onClick={() => void saveEdit(u)} disabled={editBusy}>
                              {editBusy ? 'Saving…' : 'Save'}
                            </Button>
                            <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => setEditingId(null)}>Cancel</Button>
                          </div>
                          {editErr && <p className="text-xs text-destructive">{editErr}</p>}
                        </div>
                      ) : u.full_name}
                    </td>
                    <td className="p-3">{u.email}</td>
                    <td className="p-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${status.className}`}>{status.label}</span>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {u.locked && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800" title="Too many wrong passwords. A new password lifts it.">Held</span>}
                        {u.two_step_enabled && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">Two-step</span>}
                      </div>
                    </td>
                    <td className="p-3">
                      {/* The API refuses changing your own role, so a firm can't be left without an
                          admin. Words, not a locked menu: a greyed "Firm admin" read as broken. */}
                      {isSelf ? (
                        <p className="text-sm font-medium" title="Another firm admin can change your role.">
                          {u.custom_role?.name ?? ROLE_LABELS[u.role]} <span className="text-xs text-muted-foreground">(You)</span>
                        </p>
                      ) : (
                        <AppSelect
                          className="h-9 rounded-md border bg-background px-2 text-sm"
                          value={u.custom_role ? custom(u.custom_role.id) : builtin(u.role)}
                          onChange={e => changeRole(u.id, e.target.value)}
                        >
                          <RoleOptions roles={customRoles} />
                        </AppSelect>
                      )}
                      {/* What the role allows, area by area, is changed on Setup → Roles. */}
                      {u.custom_role && (
                        <Link to={`/setup/roles?edit=${u.custom_role.id}`} className="mt-1 block text-xs text-link hover:underline">
                          Change what {u.custom_role.name} allows
                        </Link>
                      )}
                      {/* Payroll has pay rates and social security numbers; it can be closed to a login. */}
                      <label className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground" title={u.role === 'firm_admin' ? 'A firm admin always has payroll' : undefined}>
                        <input type="checkbox" checked={u.payroll_access} disabled={u.role === 'firm_admin' || u.role === 'client'} onChange={e => void setPayroll(u, e.target.checked)} />
                        Payroll
                      </label>
                    </td>
                    <td className="p-3">
                      {u.role === 'firm_admin' ? (
                        <span className="text-xs text-muted-foreground">All businesses</span>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="text-left text-xs hover:underline"
                            onClick={() => setExpandedAccess(cur => (cur === u.id ? null : u.id))}
                          >
                            {expandedAccess === u.id ? 'Hide' : businessAccessSummary(u)}
                          </button>
                          {expandedAccess === u.id && (
                            <div className="mt-2 space-y-2">
                              <ul className="space-y-1">
                                {u.business_access.length === 0 && <li className="text-xs text-muted-foreground">None</li>}
                                {u.business_access.map(a => (
                                  <li key={a.business_id} className="flex items-center gap-2 text-xs">
                                    <span>{a.business_name}</span>
                                    {(a.custom_role || a.role_override) && (
                                      <span className="rounded-full border px-2 py-0.5">
                                        as {a.custom_role ? a.custom_role.name : a.role_override ? ROLE_LABELS[a.role_override] : ''}
                                      </span>
                                    )}
                                    <button type="button" className="text-destructive hover:underline" onClick={() => revoke(u.id, a.business_id)}>revoke</button>
                                  </li>
                                ))}
                              </ul>
                              {grantFor === u.id ? (
                                <form className="grid grid-cols-1 gap-2 md:grid-cols-3 md:items-end" onSubmit={submitGrant}>
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
                                    <Label className="text-xs">Role in this company (optional)</Label>
                                    <AppSelect
                                      className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                                      value={grantForm.access}
                                      onChange={e => setGrantForm(g => ({ ...g, access: e.target.value }))}
                                    >
                                      <option value="">Their own role</option>
                                      <RoleOptions roles={customRoles} />
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
                              ) : (
                                <button type="button" className="text-xs text-link hover:underline" onClick={() => openGrant(u.id)}>Grant access</button>
                              )}
                            </div>
                          )}
                        </>
                      )}
                    </td>
                    <td className="p-3 text-right">
                      {actionsMenu(u)}
                      {rowFlash?.id === u.id && (
                        <p className={`mt-1 text-xs ${rowFlash.tone === 'success' ? 'text-emerald-700' : 'text-destructive'}`}>{rowFlash.text}</p>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filteredUsers.length === 0 && (
                <tr>
                  <td className="p-6 text-center text-muted-foreground" colSpan={6}>
                    {users.length === 0 ? 'No users yet.' : 'No users match the search and filters.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <FirmSignInSettings withoutTwoStep={users.filter(u => !u.deactivated_at && !u.two_step_enabled).length} />
    </div>
  );
}
