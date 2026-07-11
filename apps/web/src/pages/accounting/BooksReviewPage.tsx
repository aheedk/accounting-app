import { useEffect, useState } from 'react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { pickErr } from '@/lib/apiErrors';

type Period = {
  id: string;
  starts_on: string;
  ends_on: string;
  status: 'open' | 'closed';
  closed_at: string | null;
};

type TaskKey = 'reconcile_bank' | 'post_adjustments' | 'review_unreviewed_txns' | 'close_period';
type TaskStatus = 'todo' | 'in_progress' | 'done';

type Task = {
  id: string;
  business_id: string;
  period_id: string;
  task_key: TaskKey;
  status: TaskStatus;
  assignee_user_id: string | null;
  notes: string | null;
  signed_off_at: string | null;
  signed_off_by_user_id: string | null;
};

const TASK_LABELS: Record<TaskKey, string> = {
  reconcile_bank: 'Reconcile bank',
  post_adjustments: 'Post adjustments',
  review_unreviewed_txns: 'Review unreviewed transactions',
  close_period: 'Close period',
};

function taskStatusBadge(status: TaskStatus) {
  const base = 'inline-flex rounded-full px-2 py-0.5 text-xs font-medium';
  switch (status) {
    case 'done':
      return <span className={`${base} bg-emerald-100 text-emerald-800`}>Done</span>;
    case 'in_progress':
      return <span className={`${base} bg-amber-100 text-amber-800`}>In progress</span>;
    default:
      return <span className={`${base} bg-muted text-muted-foreground`}>To do</span>;
  }
}


export default function BooksReviewPage() {
  const [bizId] = useActiveBusinessId();
  const [periods, setPeriods] = useState<Period[]>([]);
  const [periodId, setPeriodId] = useState<string>('');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loadingTasks, setLoadingTasks] = useState(false);

  // Load fiscal periods for the active business; default to most recent open period.
  useEffect(() => {
    if (!bizId) {
      setPeriods([]);
      setPeriodId('');
      return;
    }
    setErr(null);
    api.get<{ periods: Period[] }>(`/businesses/${bizId}/periods`)
      .then(r => {
        const sorted = [...r.data.periods].sort((a, b) => b.starts_on.localeCompare(a.starts_on));
        setPeriods(sorted);
        const firstOpen = sorted.find(p => p.status === 'open') ?? sorted[0];
        setPeriodId(firstOpen ? firstOpen.id : '');
      })
      .catch((e: unknown) => setErr(pickErr(e)));
  }, [bizId]);

  async function loadTasks() {
    if (!bizId || !periodId) {
      setTasks([]);
      return;
    }
    setLoadingTasks(true);
    try {
      const r = await api.get<{ tasks: Task[] }>(`/businesses/${bizId}/fiscal-periods/${periodId}/review-tasks`);
      setTasks(r.data.tasks);
    } catch (e: unknown) {
      setErr(pickErr(e));
    } finally {
      setLoadingTasks(false);
    }
  }

  useEffect(() => {
    void loadTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bizId, periodId]);

  async function patchTask(id: string, patch: { status?: TaskStatus; notes?: string | null }) {
    if (!bizId) return;
    setErr(null);
    try {
      await api.patch(`/businesses/${bizId}/review-tasks/${id}`, patch);
      await loadTasks();
    } catch (e: unknown) {
      setErr(pickErr(e));
    }
  }

  if (!bizId) return <div>Pick a business.</div>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Books Review</h1>

      {err && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {err}
        </div>
      )}

      <Card>
        <CardHeader><CardTitle>Fiscal period</CardTitle></CardHeader>
        <CardContent>
          <div className="max-w-md">
            <Label>Period</Label>
            <select
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={periodId}
              onChange={e => setPeriodId(e.target.value)}
            >
              <option value="">Select…</option>
              {periods.map(p => (
                <option key={p.id} value={p.id}>
                  {p.starts_on} → {p.ends_on} ({p.status})
                </option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      {periodId && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle>Review checklist</CardTitle>
              {tasks.length > 0 && (
                <span className="text-sm text-muted-foreground">
                  {tasks.filter(t => t.status === 'done').length} of {tasks.length} signed off
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {loadingTasks && tasks.length === 0 ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : tasks.length === 0 ? (
              <p className="text-sm text-muted-foreground">No review tasks for this period yet.</p>
            ) : (
              <div className="space-y-3">
                {tasks.map(t => (
                  <div key={t.id} className="rounded-md border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{TASK_LABELS[t.task_key]}</span>
                        {taskStatusBadge(t.status)}
                      </div>
                      <div className="flex items-center gap-2">
                        <Label className="text-xs text-muted-foreground">Status</Label>
                        <select
                          className="h-9 rounded-md border bg-background px-2 text-sm"
                          value={t.status}
                          onChange={e => void patchTask(t.id, { status: e.target.value as TaskStatus })}
                        >
                          <option value="todo">Todo</option>
                          <option value="in_progress">In progress</option>
                          <option value="done">Done</option>
                        </select>
                      </div>
                    </div>

                    <div className="mt-3">
                      <Label className="text-xs text-muted-foreground">Notes</Label>
                      <textarea
                        className="mt-1 w-full rounded-md border bg-background px-2 py-1 text-sm"
                        placeholder="Notes…"
                        defaultValue={t.notes ?? ''}
                        rows={2}
                        onBlur={e => {
                          const v = e.target.value;
                          const next = v.trim().length > 0 ? v : null;
                          if (next !== (t.notes ?? null)) void patchTask(t.id, { notes: next });
                        }}
                      />
                    </div>

                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                      {t.status !== 'done' ? (
                        <Button size="sm" onClick={() => void patchTask(t.id, { status: 'done' })}>
                          Sign off
                        </Button>
                      ) : <span />}
                      {t.signed_off_at && (
                        <div className="text-xs text-muted-foreground">
                          Signed off {new Date(t.signed_off_at).toLocaleString()}
                          {t.signed_off_by_user_id ? ` by ${t.signed_off_by_user_id}` : ''}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
