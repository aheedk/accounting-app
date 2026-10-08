import { Fragment, useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { useEffectiveRole } from '@/lib/roleAccess';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { AppSelect } from '../../components/ui/select';
import { EmptyState } from '@/components/ui/EmptyState';
import { pickErr } from '@/lib/apiErrors';
import { fmtDateTime } from '@/lib/dates';
import { activityRecordName, activityVerb } from '@/lib/activityLabels';
import { humanizeCode } from '@/lib/labels';

type Row = {
  id: string;
  created_at: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  user_name: string | null;
  before: unknown;
  after: unknown;
};
type Facets = { users: { id: string; name: string }[]; entity_types: string[] };
type Page = { rows: Row[]; has_more: boolean; facets?: Facets };

const PAGE_SIZE = 50;

// Who did what, newest first. Every change has always been recorded; this is
// where it can be read for a whole company instead of one record at a time. A
// firm admin can also see what belongs to no company: sign-ins and the users.
export default function ActivityLogPage() {
  const [bizId] = useActiveBusinessId();
  const isFirmAdmin = useEffectiveRole() === 'firm_admin';
  const [scope, setScope] = useState<'company' | 'firm'>('company');
  const [rows, setRows] = useState<Row[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [facets, setFacets] = useState<Facets>({ users: [], entity_types: [] });
  const [userId, setUserId] = useState('');
  const [entityType, setEntityType] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const url = scope === 'firm' ? '/me/firm/activity-log' : bizId ? `/businesses/${bizId}/activity-log` : null;

  const load = useCallback(async (before?: string) => {
    if (!url) return;
    setLoading(true); setErr(null);
    try {
      const r = await api.get<Page>(url, {
        params: { limit: PAGE_SIZE, ...(before ? { before } : {}), ...(userId ? { user_id: userId } : {}), ...(entityType ? { entity_type: entityType } : {}) },
      });
      setRows(current => (before ? [...current, ...r.data.rows] : r.data.rows));
      setHasMore(r.data.has_more);
      if (r.data.facets) setFacets(r.data.facets);
    } catch (e: unknown) { setErr(pickErr(e)); }
    finally { setLoading(false); }
  }, [url, userId, entityType]);

  useEffect(() => { void load(); }, [load]);

  function switchScope(next: 'company' | 'firm') {
    setScope(next); setUserId(''); setEntityType(''); setRows([]); setOpenId(null);
  }

  if (!bizId && scope === 'company') return <div>Pick a business.</div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Activity Log</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {scope === 'firm' ? 'Sign-ins and changes to the firm’s users.' : 'Everything that was added, changed, posted or voided in this company, and by whom.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isFirmAdmin && (
            <AppSelect className="h-9 rounded-md border bg-background px-3 text-sm" value={scope} onChange={e => switchScope(e.target.value as 'company' | 'firm')} aria-label="Which log">
              <option value="company">This company</option>
              <option value="firm">Sign-ins and users</option>
            </AppSelect>
          )}
          <AppSelect className="h-9 rounded-md border bg-background px-3 text-sm" value={userId} onChange={e => setUserId(e.target.value)} aria-label="Person">
            <option value="">Everyone</option>
            {facets.users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </AppSelect>
          <AppSelect className="h-9 rounded-md border bg-background px-3 text-sm" value={entityType} onChange={e => setEntityType(e.target.value)} aria-label="Kind of record">
            <option value="">Every kind of record</option>
            {facets.entity_types.map(t => <option key={t} value={t}>{humanizeCode(t)}</option>)}
          </AppSelect>
        </div>
      </div>

      {err && <p className="text-sm text-destructive">{err}</p>}

      <Card><CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40">
            <tr className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <th className="p-3 text-left">When</th>
              <th className="p-3 text-left">Who</th>
              <th className="p-3 text-left">What</th>
              <th className="p-3 text-left">Record</th>
              <th className="p-3 text-right">Detail</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && (
              <tr><td colSpan={5} className="p-0"><EmptyState title="Nothing recorded" hint="Nothing matches, or nothing has been done here yet." /></td></tr>
            )}
            {rows.map(row => {
              const name = activityRecordName(row.after ?? row.before);
              const open = openId === row.id;
              return (
                <Fragment key={row.id}>
                  <tr className="border-b last:border-b-0 hover:bg-muted/30">
                    <td className="p-3 whitespace-nowrap">{fmtDateTime(row.created_at)}</td>
                    <td className="p-3">{row.user_name ?? 'System'}</td>
                    <td className="p-3">{activityVerb(row.action)}</td>
                    <td className="p-3">
                      {humanizeCode(row.entity_type)}
                      {name && <span className="ml-1 text-muted-foreground">{name}</span>}
                    </td>
                    <td className="p-3 text-right">
                      {(row.before !== null || row.after !== null) && (
                        <Button size="sm" variant="ghost" className="h-auto p-0 font-normal text-primary hover:text-primary" onClick={() => setOpenId(open ? null : row.id)}>
                          {open ? 'Hide' : 'Show'}
                        </Button>
                      )}
                    </td>
                  </tr>
                  {open && (
                    <tr className="border-b bg-muted/20">
                      <td colSpan={5} className="p-3">
                        <div className="grid gap-3 text-xs md:grid-cols-2">
                          <div>
                            <p className="mb-1 font-medium text-muted-foreground">Before</p>
                            <pre className="max-h-64 overflow-auto rounded bg-muted/50 p-2">{row.before ? JSON.stringify(row.before, null, 2) : '—'}</pre>
                          </div>
                          <div>
                            <p className="mb-1 font-medium text-muted-foreground">After</p>
                            <pre className="max-h-64 overflow-auto rounded bg-muted/50 p-2">{row.after ? JSON.stringify(row.after, null, 2) : '—'}</pre>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </CardContent></Card>

      {hasMore && (
        <div className="text-center">
          <Button variant="outline" disabled={loading} onClick={() => void load(rows[rows.length - 1]?.created_at)}>
            {loading ? 'Loading…' : 'Show older'}
          </Button>
        </div>
      )}
    </div>
  );
}
