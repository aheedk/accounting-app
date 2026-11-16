import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
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
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { type Role, type CustomRoleRef, builtin, custom, roleChoice, RoleOptions } from './userRoleOptions';

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
  /** The firm's one owner — locked except through a transfer. */
  is_primary_admin: boolean;
};

type TransferStatus =
  | { pending: false }
  | { pending: true; target_user_id: string; target_name: string; target_email: string };

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

function errorMessage(e: unknown): string {
  return (e as { response?: { data?: { error?: { message?: string } } } } | undefined)
    ?.response?.data?.error?.message ?? 'Request failed';
}

export default function UsersPage() {
  const { user } = useAuth();
  const canManage = user?.role === 'firm_admin';
  const nav = useNavigate();

  const [users, setUsers] = useState<UserRow[]>([]);
  const [customRoles, setCustomRoles] = useState<CustomRoleRef[]>([]);
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

  // Confirming a promotion to firm admin — see changeRole.
  const [promoteConfirm, setPromoteConfirm] = useState<{ userId: string; userName: string; value: string } | null>(null);

  const [excelBusy, setExcelBusy] = useState(false);

  // Transferring the Primary Admin designation: who's pending (firm-wide, so
  // its own fetch), and the two-step modal state while it's being started.
  const [transferStatus, setTransferStatus] = useState<TransferStatus>({ pending: false });
  const [transferStep, setTransferStep] = useState<'pick' | 'confirm' | null>(null);
  const [transferTargetId, setTransferTargetId] = useState('');
  const [transferBusy, setTransferBusy] = useState(false);
  const [transferErr, setTransferErr] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setErr(null);
    try {
      const [u, r, ts] = await Promise.all([
        api.get<{ users: UserRow[] }>('/me/firm/users'),
        api.get<{ roles: CustomRoleRef[] }>('/me/firm/roles'),
        api.get<TransferStatus>('/me/firm/transfer-status'),
      ]);
      setUsers(u.data.users);
      setCustomRoles(r.data.roles.map(role => ({ id: role.id, name: role.name })));
      setTransferStatus(ts.data);
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

  async function applyRoleChange(user_id: string, value: string) {
    try {
      await api.patch(`/me/firm/users/${user_id}`, roleChoice(value));
      await reload();
    } catch (e) {
      setErr(errorMessage(e));
    }
  }

  // Firm admin is the highest level there is, so picking it asks first — an
  // escalation, not a destructive action, so the dialog's Confirm is the
  // ordinary primary button, not the red one Switch off and Delete use.
  // No other role needs this; only becoming a firm admin does.
  function changeRole(u: UserRow, value: string) {
    const choice = roleChoice(value);
    if ('role' in choice && choice.role === 'firm_admin' && u.role !== 'firm_admin') {
      setPromoteConfirm({ userId: u.id, userName: u.full_name, value });
      return;
    }
    void applyRoleChange(u.id, value);
  }

  function openTransferModal() {
    setTransferTargetId('');
    setTransferErr(null);
    setTransferStep('pick');
  }

  async function confirmTransfer() {
    setTransferBusy(true);
    setTransferErr(null);
    try {
      const r = await api.post<{ ok: boolean; target_email: string; email_sent: boolean }>(
        '/me/firm/transfer-primary-admin', { target_user_id: transferTargetId },
      );
      setTransferStep(null);
      await reload();
      if (!r.data.email_sent) {
        setErr(`Transfer started, but the email to ${r.data.target_email} couldn't be sent.`);
      }
    } catch (e) {
      setTransferErr(errorMessage(e));
    } finally {
      setTransferBusy(false);
    }
  }

  async function cancelTransfer() {
    if (!window.confirm('Cancel this transfer? The link already sent will stop working.')) return;
    setErr(null);
    try {
      await api.delete('/me/firm/transfer-primary-admin');
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

  /** The row's "⌄" menu: every action except "Edit client access", which is
   * its own link right next to this trigger — see the Actions cell below. */
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
            aria-label="More actions"
            className="text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={() => startEdit(u)}>Edit user</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => nav(`/setup/activity?scope=firm&user_id=${u.id}`)}>View user activity</DropdownMenuItem>
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

  /** The Primary Admin's own row: its dropdown trigger IS "Transfer Primary
   * Admin", replacing the "Edit client access" link + separate "⌄" every
   * other row has. Only the Primary Admin themselves sees the transfer/cancel
   * items — anyone else viewing this row would just get a 403. */
  function primaryAdminMenu(u: UserRow) {
    const isSelf = u.id === user?.id;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="inline-flex items-center gap-1 text-sm text-link hover:underline">
            Transfer Primary Admin <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {isSelf && <DropdownMenuItem onSelect={openTransferModal}>Transfer Primary Admin</DropdownMenuItem>}
          <DropdownMenuItem onSelect={() => startEdit(u)}>Edit user</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => nav(`/setup/activity?scope=firm&user_id=${u.id}`)}>View user activity</DropdownMenuItem>
          {isSelf && transferStatus.pending && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => void cancelTransfer()}>
                Cancel transfer
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  // Who the Primary Admin may transfer to: another active firm admin, not themselves.
  const eligibleTransferTargets = users.filter(u => u.role === 'firm_admin' && !u.deactivated_at && !u.is_primary_admin);

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
                <th className="text-left p-3 w-[20%]">Name</th>
                <th className="text-left p-3 w-[24%]">Email</th>
                <th className="text-left p-3 w-[14%]">Status</th>
                <th className="text-left p-3">Role</th>
                <th className="text-right p-3 w-[16%]">Actions</th>
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
                      {u.is_primary_admin ? (
                        <>
                          <p className="text-sm font-medium" title="The Primary admin role cannot be changed. Transfer the role first.">
                            Primary admin {isSelf && <span className="text-xs text-muted-foreground">(You)</span>}
                          </p>
                          {transferStatus.pending && (
                            <span className="mt-1 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                              Transfer pending to {transferStatus.target_name}
                            </span>
                          )}
                        </>
                      ) : isSelf ? (
                        <p className="text-sm font-medium" title="Another firm admin can change your role.">
                          {u.custom_role?.name ?? ROLE_LABELS[u.role]} <span className="text-xs text-muted-foreground">(You)</span>
                        </p>
                      ) : (
                        <AppSelect
                          className="h-9 rounded-md border bg-background px-2 text-sm"
                          value={u.custom_role ? custom(u.custom_role.id) : builtin(u.role)}
                          onChange={e => changeRole(u, e.target.value)}
                          disabled={isOnlyActiveFirmAdmin(u)}
                          title={isOnlyActiveFirmAdmin(u) ? 'You must assign another firm admin before changing this role.' : undefined}
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
                    <td className="p-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {u.is_primary_admin ? (
                          primaryAdminMenu(u)
                        ) : (
                          <>
                            {u.role === 'firm_admin' ? (
                              <span className="text-xs text-muted-foreground">All businesses</span>
                            ) : (
                              <Link to={`/setup/users/${u.id}/access`} className="text-link hover:underline">Edit client access</Link>
                            )}
                            {actionsMenu(u)}
                          </>
                        )}
                      </div>
                      {rowFlash?.id === u.id && (
                        <p className={`mt-1 text-xs ${rowFlash.tone === 'success' ? 'text-emerald-700' : 'text-destructive'}`}>{rowFlash.text}</p>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filteredUsers.length === 0 && (
                <tr>
                  <td className="p-6 text-center text-muted-foreground" colSpan={5}>
                    {users.length === 0 ? 'No users yet.' : 'No users match the search and filters.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <FirmSignInSettings withoutTwoStep={users.filter(u => !u.deactivated_at && !u.two_step_enabled).length} />

      <Dialog open={promoteConfirm !== null} onOpenChange={o => { if (!o) setPromoteConfirm(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Make {promoteConfirm?.userName} a firm admin?</DialogTitle></DialogHeader>
          <div className="px-6 py-4 text-sm text-muted-foreground">
            Firm admins have full access to all clients, team management, firm settings, and billing. This is the highest level of access.
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPromoteConfirm(null)}>Cancel</Button>
            <Button onClick={() => { const p = promoteConfirm; setPromoteConfirm(null); if (p) void applyRoleChange(p.userId, p.value); }}>
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={transferStep !== null} onOpenChange={o => { if (!o) setTransferStep(null); }}>
        <DialogContent>
          {transferStep === 'pick' ? (
            <>
              <DialogHeader><DialogTitle>Transfer Primary Admin</DialogTitle></DialogHeader>
              <div className="px-6 py-4 space-y-3 text-sm">
                <p className="text-muted-foreground">
                  Choose another firm admin to become the firm's Primary Admin. They'll get an email with a link to accept.
                </p>
                {eligibleTransferTargets.length === 0 ? (
                  <p className="text-muted-foreground">No eligible users — only an active firm admin other than yourself can receive the transfer.</p>
                ) : (
                  <AppSelect className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={transferTargetId} onChange={e => setTransferTargetId(e.target.value)}>
                    <option value="" disabled>Choose a firm admin…</option>
                    {eligibleTransferTargets.map(u => <option key={u.id} value={u.id}>{u.full_name} ({u.email})</option>)}
                  </AppSelect>
                )}
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setTransferStep(null)}>Cancel</Button>
                <Button disabled={!transferTargetId} onClick={() => setTransferStep('confirm')}>Continue</Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader><DialogTitle>Transfer the Primary Admin role?</DialogTitle></DialogHeader>
              <div className="px-6 py-4 text-sm text-muted-foreground">
                {eligibleTransferTargets.find(u => u.id === transferTargetId)?.full_name} will receive an email to accept.
                Once accepted, they become the firm's Primary Admin and you keep your firm admin access, just not the
                designation. You can cancel this before they accept.
              </div>
              {transferErr && <p className="px-6 text-sm text-destructive">{transferErr}</p>}
              <DialogFooter>
                <Button variant="ghost" onClick={() => setTransferStep('pick')} disabled={transferBusy}>Back</Button>
                <Button onClick={() => void confirmTransfer()} disabled={transferBusy}>
                  {transferBusy ? 'Sending…' : 'Transfer Primary Admin'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
