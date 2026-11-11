import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AREAS, AREA_INFO, LEVELS, LEVEL_INFO, ROLE_LABELS, builtInPermissions,
  type Level, type Permissions, type Role,
} from '@accounting/shared';
import { api } from '@/lib/apiClient';
import { useAuth } from '@/auth/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AppSelect } from '@/components/ui/select';

// Setup → Roles: the built-in roles, and the firm's own, set area by area.
// Spec: docs/specs/2026-11-09-custom-roles-design.md

type CustomRoleRow = {
  id: string;
  name: string;
  description: string | null;
  permissions: Permissions;
  users: Array<{ id: string; full_name: string; email: string }>;
  company_grants: number;
};

type Draft = { id: string | null; name: string; description: string; permissions: Permissions };

const BUILT_IN: Array<{ role: Role; about: string }> = [
  { role: 'firm_admin', about: 'Everything, including the firm\'s users, roles and clients.' },
  { role: 'accountant', about: 'Posts, voids, approves and closes, in every area.' },
  { role: 'staff', about: 'Data entry in every area. Entries wait for approval where a company asks.' },
  { role: 'viewer', about: 'Reads everything staff read and changes nothing. For a reviewer or an auditor.' },
  { role: 'client', about: 'Its own reports, invoices and bills; sends documents in and writes messages.' },
];

const LEVEL_PILL: Record<Level, string> = {
  none: 'bg-muted text-muted-foreground',
  view: 'bg-slate-100 text-slate-800',
  enter: 'bg-sky-100 text-sky-800',
  post: 'bg-emerald-100 text-emerald-800',
  full: 'bg-amber-100 text-amber-800',
};

const allAt = (level: Level): Permissions => Object.fromEntries(AREAS.map(area => [area, level])) as Permissions;

function errorMessage(e: unknown): string {
  return (e as { response?: { data?: { error?: { message?: string } } } } | undefined)
    ?.response?.data?.error?.message ?? 'Request failed';
}

/** One line per role: each area at its level, the ones with no access left out. */
function LevelSummary({ permissions }: { permissions: Permissions }) {
  const open = AREAS.filter(area => permissions[area] !== 'none');
  if (open.length === 0) return <span className="text-xs text-muted-foreground">No access anywhere</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {open.map(area => (
        <span key={area} className={`rounded-full px-2 py-0.5 text-xs font-medium ${LEVEL_PILL[permissions[area]]}`}>
          {AREA_INFO[area].label}: {LEVEL_INFO[permissions[area]].label}
        </span>
      ))}
    </div>
  );
}

export default function RolesPage() {
  const { user } = useAuth();
  const canManage = user?.role === 'firm_admin';
  const [params, setParams] = useSearchParams();

  const [roles, setRoles] = useState<CustomRoleRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftErr, setDraftErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setErr(null);
    try {
      const r = await api.get<{ roles: CustomRoleRow[] }>('/me/firm/roles');
      setRoles(r.data.roles);
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { if (canManage) void reload(); }, [canManage, reload]);

  // Setup → Users links here with ?edit=<role id> to change what a login's role allows.
  const editId = params.get('edit');
  useEffect(() => {
    if (!editId || !loaded) return;
    const role = roles.find(r => r.id === editId);
    if (role) setDraft({ id: role.id, name: role.name, description: role.description ?? '', permissions: role.permissions });
    setParams(p => { p.delete('edit'); return p; }, { replace: true });
  }, [editId, loaded, roles, setParams]);

  const editing = draft?.id ? roles.find(r => r.id === draft.id) ?? null : null;
  const holders = editing ? editing.users.length + editing.company_grants : 0;

  function startNew(from: Permissions = allAt('view'), name = '') {
    setDraftErr(null);
    setDraft({ id: null, name, description: '', permissions: { ...from } });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function startEdit(role: CustomRoleRow) {
    setDraftErr(null);
    setDraft({ id: role.id, name: role.name, description: role.description ?? '', permissions: { ...role.permissions } });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function setLevel(area: (typeof AREAS)[number], level: Level) {
    setDraft(d => (d ? { ...d, permissions: { ...d.permissions, [area]: level } } : d));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setBusy(true);
    setDraftErr(null);
    const body = { name: draft.name.trim(), description: draft.description.trim() || null, permissions: draft.permissions };
    try {
      if (draft.id) await api.patch(`/me/firm/roles/${draft.id}`, body);
      else await api.post('/me/firm/roles', body);
      setDraft(null);
      await reload();
    } catch (e2) {
      setDraftErr(errorMessage(e2));
    } finally {
      setBusy(false);
    }
  }

  async function remove(role: CustomRoleRow) {
    if (!window.confirm(`Delete the role ${role.name}?`)) return;
    setErr(null);
    try {
      await api.delete(`/me/firm/roles/${role.id}`);
      if (draft?.id === role.id) setDraft(null);
      await reload();
    } catch (e) {
      setErr(errorMessage(e));
    }
  }

  // "Start from" in the editor: any built-in role but Client, or another custom role.
  const starts = useMemo(() => [
    ...BUILT_IN.filter(b => b.role !== 'client').map(b => ({ key: `builtin:${b.role}`, label: ROLE_LABELS[b.role], permissions: builtInPermissions(b.role)! })),
    ...roles.filter(r => r.id !== draft?.id).map(r => ({ key: `custom:${r.id}`, label: r.name, permissions: r.permissions })),
  ], [roles, draft?.id]);

  if (!canManage) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">Roles</h1>
        <Card><CardContent className="py-6 text-sm text-muted-foreground">Only firm admins can manage roles.</CardContent></Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Roles</h1>
          <p className="text-sm text-muted-foreground">
            Make roles of your own and choose, area by area, how far each goes. Give them to logins on{' '}
            <Link to="/setup/users" className="text-link hover:underline">Users</Link>, for the whole firm or for one company.
          </p>
        </div>
        {!draft && <Button onClick={() => startNew()}>New role</Button>}
      </div>

      {err && <p className="text-sm text-destructive">{err}</p>}

      {draft && (
        <Card>
          <CardHeader>
            <CardTitle>{draft.id ? `Edit ${editing?.name ?? 'role'}` : 'New role'}</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="space-y-5" onSubmit={save}>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div>
                  <Label>Name</Label>
                  <Input required maxLength={60} value={draft.name} placeholder="Bookkeeper"
                    onChange={e => setDraft(d => (d ? { ...d, name: e.target.value } : d))} />
                </div>
                <div className="md:col-span-2">
                  <Label>What it is for</Label>
                  <Input maxLength={300} value={draft.description} placeholder="Enters bills and bank lines; no payroll"
                    onChange={e => setDraft(d => (d ? { ...d, description: e.target.value } : d))} />
                </div>
              </div>

              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <Label className="text-xs">Start from</Label>
                  <AppSelect
                    className="h-9 rounded-md border bg-background px-2 text-sm"
                    value=""
                    onChange={e => {
                      const start = starts.find(s => s.key === e.target.value);
                      if (start) setDraft(d => (d ? { ...d, permissions: { ...start.permissions } } : d));
                    }}
                  >
                    <option value="">Copy the levels of…</option>
                    {starts.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </AppSelect>
                </div>
                <p className="text-xs text-muted-foreground">Or click a level's name to set every area to it.</p>
              </div>

              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/40">
                    <tr className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      <th className="p-3 text-left">Area</th>
                      {LEVELS.map(level => (
                        <th key={level} className="p-3 text-center">
                          <button type="button" className="uppercase hover:text-foreground hover:underline" title={LEVEL_INFO[level].means}
                            onClick={() => setDraft(d => (d ? { ...d, permissions: allAt(level) } : d))}>
                            {LEVEL_INFO[level].label}
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {AREAS.map(area => (
                      <tr key={area} className="border-b last:border-b-0 hover:bg-muted/30">
                        <td className="p-3">
                          <div className="font-medium">{AREA_INFO[area].label}</div>
                          <div className="text-xs text-muted-foreground">{AREA_INFO[area].covers}</div>
                        </td>
                        {LEVELS.map(level => (
                          <td key={level} className="p-3 text-center">
                            <input
                              type="radio"
                              name={`level-${area}`}
                              aria-label={`${AREA_INFO[area].label}: ${LEVEL_INFO[level].label}`}
                              checked={draft.permissions[area] === level}
                              onChange={() => setLevel(area, level)}
                              className="h-4 w-4 accent-primary"
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <ul className="grid grid-cols-1 gap-1 text-xs text-muted-foreground md:grid-cols-2">
                {LEVELS.map(level => (
                  <li key={level}>
                    <span className={`mr-1.5 rounded-full px-2 py-0.5 font-medium ${LEVEL_PILL[level]}`}>{LEVEL_INFO[level].label}</span>
                    {LEVEL_INFO[level].means}
                  </li>
                ))}
              </ul>

              {draft.id && holders > 0 && (
                <p className="text-sm text-muted-foreground">
                  Saving changes what {holders === 1 ? 'one login has' : `${holders} grants have`} at once; their browsers redraw the menu.
                </p>
              )}
              {draftErr && <p className="text-sm text-destructive">{draftErr}</p>}
              <div className="flex gap-2">
                <Button type="submit" disabled={busy}>{busy ? 'Saving…' : draft.id ? 'Save changes' : 'Create role'}</Button>
                <Button type="button" variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Your firm's roles</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40">
              <tr className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <th className="p-3 text-left">Role</th>
                <th className="p-3 text-left">What it allows</th>
                <th className="p-3 text-left">Who has it</th>
                <th className="p-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {roles.map(role => (
                <tr key={role.id} className="border-b align-top last:border-b-0 hover:bg-muted/30">
                  <td className="p-3">
                    <div className="font-medium">{role.name}</div>
                    {role.description && <div className="text-xs text-muted-foreground">{role.description}</div>}
                  </td>
                  <td className="p-3"><LevelSummary permissions={role.permissions} /></td>
                  <td className="p-3 text-xs">
                    {role.users.length === 0 && role.company_grants === 0 && <span className="text-muted-foreground">Nobody yet</span>}
                    {role.users.map(u => <div key={u.id}>{u.full_name}</div>)}
                    {role.company_grants > 0 && (
                      <div className="text-muted-foreground">
                        {role.company_grants === 1 ? 'One company grant' : `${role.company_grants} company grants`}
                      </div>
                    )}
                  </td>
                  <td className="p-3 text-right">
                    <div className="flex flex-col items-end gap-1 text-xs">
                      <button type="button" className="text-link hover:underline" onClick={() => startEdit(role)}>Edit</button>
                      <button type="button" className="text-link hover:underline" onClick={() => startNew(role.permissions, `${role.name} (copy)`)}>Duplicate</button>
                      <button type="button" className="text-destructive hover:underline" onClick={() => void remove(role)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
              {loaded && roles.length === 0 && (
                <tr>
                  <td className="p-6 text-center text-muted-foreground" colSpan={4}>
                    No roles of your own yet. Start one with New role, or duplicate a built-in role below.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Built-in roles</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <tbody>
              {BUILT_IN.map(({ role, about }) => {
                const permissions = builtInPermissions(role);
                return (
                  <tr key={role} className="border-b align-top last:border-b-0 hover:bg-muted/30">
                    <td className="w-48 p-3">
                      <div className="font-medium">{ROLE_LABELS[role]}</div>
                      <span className="text-xs text-muted-foreground">Built-in</span>
                    </td>
                    <td className="p-3">
                      <p className="mb-1.5 text-xs text-muted-foreground">{about}</p>
                      {permissions && <LevelSummary permissions={permissions} />}
                    </td>
                    <td className="p-3 text-right text-xs">
                      {permissions && (
                        <button type="button" className="text-link hover:underline" onClick={() => startNew(permissions, `${ROLE_LABELS[role]} (custom)`)}>
                          Duplicate
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
