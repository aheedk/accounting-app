import { Fragment, useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { AppSelect } from '../../components/ui/select';
import { EmptyState } from '@/components/ui/EmptyState';
import { pickErr } from '@/lib/apiErrors';
import { fmtDateTime } from '@/lib/dates';
import { flashMessage } from '@/lib/flash';
import { fmtMoney } from '@/lib/money';
import { roleAtLeast, useEffectiveRole } from '@/lib/roleAccess';

type Approval = {
  id: string;
  action: string;
  summary: string;
  amount: string | null;
  status: 'pending' | 'approved' | 'rejected';
  payload: unknown;
  created_at: string;
  requested_by: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
};
type Listing = { requests: Approval[]; needs_approval: boolean };

const STATUS_STYLE: Record<Approval['status'], string> = {
  pending: 'bg-amber-100 text-amber-800',
  approved: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-rose-100 text-rose-800',
};
const STATUS_LABEL: Record<Approval['status'], string> = { pending: 'Waiting', approved: 'Approved', rejected: 'Rejected' };

// What staff entered that is waiting for an accountant. Expenses, checks,
// deposits, bank lines, item receipts and stock adjustments have no draft, so
// in a company with approval switched on they wait here instead of posting.
// An accountant approves or rejects; staff see what became of their own.
export default function ApprovalsPage() {
  const [bizId] = useActiveBusinessId();
  const role = useEffectiveRole();
  const canDecide = roleAtLeast(role, 'accountant');
  const isFirmAdmin = role === 'firm_admin';

  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected' | ''>('pending');
  const [requests, setRequests] = useState<Approval[]>([]);
  const [needsApproval, setNeedsApproval] = useState<boolean | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!bizId) return;
    try {
      const r = await api.get<Listing>(`/businesses/${bizId}/approvals`, { params: status ? { status } : {} });
      setRequests(r.data.requests);
      setNeedsApproval(r.data.needs_approval);
      setErr(null);
    } catch (e: unknown) { setErr(pickErr(e)); }
  }, [bizId, status]);
  useEffect(() => { void reload(); }, [reload]);

  async function decide(request: Approval, decision: 'approve' | 'reject') {
    if (!bizId) return;
    let note: string | null = null;
    if (decision === 'reject') {
      // Blank is allowed; Cancel leaves it waiting.
      const typed = window.prompt('Why is it rejected? The person who entered it will see this.');
      if (typed === null) return;
      note = typed.trim() || null;
    }
    setBusyId(request.id); setErr(null);
    try {
      await api.post(`/businesses/${bizId}/approvals/${request.id}/${decision}`, decision === 'reject' ? { note } : {});
      flashMessage(decision === 'approve' ? 'Approved and recorded.' : 'Rejected.');
      await reload();
    } catch (e: unknown) {
      // What recording it said, e.g. a closed period. It is still waiting.
      setErr(`${request.summary}: ${pickErr(e)}`);
    } finally { setBusyId(null); }
  }

  async function setSwitch(on: boolean) {
    if (!bizId) return;
    try {
      await api.patch(`/businesses/${bizId}`, { staff_entries_need_approval: on });
      setNeedsApproval(on);
      flashMessage(on ? 'Staff entries now wait for approval.' : 'Staff entries are recorded as they are saved.', 4000);
    } catch (e: unknown) { setErr(pickErr(e)); }
  }

  if (!bizId) return <div>Pick a business.</div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Approvals</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {canDecide
              ? 'Expenses, checks, deposits, bank lines, item receipts and stock adjustments entered by staff. They are in the books only once approved here.'
              : 'What you entered that is waiting for an accountant, and what became of it.'}
          </p>
        </div>
        <AppSelect className="h-9 rounded-md border bg-background px-3 text-sm" value={status} onChange={e => setStatus(e.target.value as typeof status)} aria-label="Status">
          <option value="pending">Waiting</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="">All</option>
        </AppSelect>
      </div>

      {needsApproval !== null && (
        <div className={`rounded-md border px-4 py-3 text-sm ${needsApproval ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'bg-muted/40 text-muted-foreground'}`}>
          {needsApproval
            ? 'Approval is on for this company: what staff enter waits here before it is recorded.'
            : 'Approval is off for this company: what staff enter is recorded as they save it.'}
          {isFirmAdmin && (
            <Button size="sm" variant="outline" className="ml-3" onClick={() => void setSwitch(!needsApproval)}>
              {needsApproval ? 'Turn off' : 'Turn on'}
            </Button>
          )}
          {!isFirmAdmin && canDecide && <span className="ml-1">A firm admin can change this.</span>}
        </div>
      )}

      {err && <p className="text-sm text-destructive">{err}</p>}

      <Card><CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40">
            <tr className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <th className="p-3 text-left">Entered</th>
              <th className="p-3 text-left">By</th>
              <th className="p-3 text-left">What</th>
              <th className="p-3 text-right">Amount</th>
              <th className="p-3 text-left">Status</th>
              <th className="p-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {requests.length === 0 && (
              <tr><td colSpan={6} className="p-0"><EmptyState title={status === 'pending' ? 'Nothing is waiting' : 'Nothing here'} hint={needsApproval ? 'Entries staff save will appear here.' : 'With approval off, nothing waits.'} /></td></tr>
            )}
            {requests.map(r => {
              const open = openId === r.id;
              return (
                <Fragment key={r.id}>
                  <tr className="border-b last:border-b-0 align-top hover:bg-muted/30">
                    <td className="p-3 whitespace-nowrap">{fmtDateTime(r.created_at)}</td>
                    <td className="p-3">{r.requested_by}</td>
                    <td className="p-3">
                      {r.summary}
                      {r.status !== 'pending' && (
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {STATUS_LABEL[r.status]} by {r.decided_by ?? 'someone'}{r.decided_at ? `, ${fmtDateTime(r.decided_at)}` : ''}
                          {r.decision_note ? `: ${r.decision_note}` : ''}
                        </div>
                      )}
                    </td>
                    <td className="p-3 text-right font-mono">{r.amount !== null ? fmtMoney(r.amount) : '—'}</td>
                    <td className="p-3"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[r.status]}`}>{STATUS_LABEL[r.status]}</span></td>
                    <td className="p-3 text-right whitespace-nowrap">
                      <Button size="sm" variant="ghost" className="mr-3 h-auto p-0 font-normal text-primary hover:text-primary" onClick={() => setOpenId(open ? null : r.id)}>
                        {open ? 'Hide' : 'Details'}
                      </Button>
                      {canDecide && r.status === 'pending' && (
                        <>
                          <Button size="sm" className="mr-2" disabled={busyId === r.id} onClick={() => void decide(r, 'approve')}>
                            {busyId === r.id ? 'Recording…' : 'Approve'}
                          </Button>
                          <Button size="sm" variant="outline" disabled={busyId === r.id} onClick={() => void decide(r, 'reject')}>Reject</Button>
                        </>
                      )}
                    </td>
                  </tr>
                  {open && (
                    <tr className="border-b bg-muted/20">
                      <td colSpan={6} className="p-3">
                        <p className="mb-1 text-xs font-medium text-muted-foreground">Exactly what was entered</p>
                        <pre className="max-h-72 overflow-auto rounded bg-muted/50 p-2 text-xs">{JSON.stringify(r.payload, null, 2)}</pre>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </CardContent></Card>
    </div>
  );
}
