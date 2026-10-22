import { useMemo, useState } from 'react';
import { View, ScrollView, Pressable } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { hasMinRole, type Role } from '@accounting/shared';
import { useAuth } from '../hooks/useAuth';
import { AppHeader } from '../components/AppHeader';
import { AppCard } from '../components/ui/AppCard';
import { AppButton } from '../components/ui/AppButton';
import { AppTextInput } from '../components/ui/AppTextInput';
import { AppSegmentedControl } from '../components/ui/AppSegmentedControl';
import { AppMenu, AppMenuItem } from '../components/ui/AppMenu';
import { StatusBadge } from '../components/ui/StatusBadge';
import {
  listFiscalPeriods, listReviewTasks, updateReviewTask,
  type FiscalPeriod, type ReviewTask, type ReviewTaskStatus, type ReviewTaskKey,
} from '../services/api';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import { fmtShortDate } from '../lib/money';
import { spacing, typeScale, fontFamily, type AppTheme } from '../theme';

const TASK_LABELS: Record<ReviewTaskKey, string> = {
  reconcile_bank: 'Reconcile bank',
  post_adjustments: 'Post adjustments',
  review_unreviewed_txns: 'Review unreviewed transactions',
  close_period: 'Close period',
};

// Same default as web's BooksReviewPage: today's period, else the latest
// open period that's already started, else the latest open period, else
// just the first one.
function pickDefaultPeriod(periods: FiscalPeriod[]): FiscalPeriod | null {
  if (periods.length === 0) return null;
  const sorted = [...periods].sort((a, b) => b.starts_on.localeCompare(a.starts_on));
  const today = new Date().toISOString().slice(0, 10);
  const containingToday = sorted.find(p => p.starts_on <= today && p.ends_on >= today);
  if (containingToday) return containingToday;
  const openStarted = sorted.find(p => p.status === 'open' && p.starts_on <= today);
  if (openStarted) return openStarted;
  const anyOpen = sorted.find(p => p.status === 'open');
  if (anyOpen) return anyOpen;
  return sorted[0] ?? null;
}

export default function BooksReviewScreen() {
  const theme = useTheme<AppTheme>();
  const { activeBusinessId, businesses, user } = useAuth();
  const queryClient = useQueryClient();
  const [periodId, setPeriodId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const effectiveRole = (businesses.find(b => b.id === activeBusinessId)?.role_override ?? user?.role ?? 'viewer') as Role;
  const canSignOff = hasMinRole(effectiveRole, 'accountant');

  const periodsQuery = useQuery({
    queryKey: ['fiscal-periods', activeBusinessId],
    queryFn: () => listFiscalPeriods(activeBusinessId!),
    enabled: !!activeBusinessId,
  });

  const periods = periodsQuery.data ?? [];
  const sortedPeriods = useMemo(() => [...periods].sort((a, b) => b.starts_on.localeCompare(a.starts_on)), [periods]);
  const selectedPeriod = periodId ? periods.find(p => p.id === periodId) ?? null : pickDefaultPeriod(periods);
  const effectivePeriodId = selectedPeriod?.id ?? null;

  const tasksQuery = useQuery({
    queryKey: ['review-tasks', activeBusinessId, effectivePeriodId],
    queryFn: () => listReviewTasks(activeBusinessId!, effectivePeriodId!),
    enabled: !!activeBusinessId && !!effectivePeriodId,
  });

  const tasks = tasksQuery.data ?? [];
  const doneCount = tasks.filter(t => t.status === 'done').length;

  async function handlePatch(task: ReviewTask, patch: { status?: ReviewTaskStatus; notes?: string | null }) {
    await updateReviewTask(activeBusinessId!, task.id, patch);
    await queryClient.invalidateQueries({ queryKey: ['review-tasks', activeBusinessId, effectivePeriodId] });
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title="Books Review" />

      {periodsQuery.isLoading ? (
        <LoadingIndicator />
      ) : periodsQuery.error ? (
        <ErrorState onRetry={() => void periodsQuery.refetch()} />
      ) : !selectedPeriod ? (
        <EmptyState icon="calendar-blank-outline" message="No fiscal periods set up yet." />
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xxl }}>
          <AppMenu
            visible={pickerOpen}
            onDismiss={() => setPickerOpen(false)}
            anchor={
              <Pressable
                onPress={() => setPickerOpen(true)}
                style={{
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                  borderWidth: 1, borderColor: theme.app.border, borderRadius: 8,
                  paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginBottom: spacing.md,
                }}
              >
                <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.medium }}>
                  {fmtShortDate(selectedPeriod.starts_on)} – {fmtShortDate(selectedPeriod.ends_on)}
                </Text>
                <MaterialCommunityIcons name="chevron-down" size={18} color={theme.app.mutedForeground} />
              </Pressable>
            }
          >
            {sortedPeriods.map(p => (
              <AppMenuItem
                key={p.id}
                title={`${fmtShortDate(p.starts_on)} – ${fmtShortDate(p.ends_on)} (${p.status})`}
                onPress={() => { setPeriodId(p.id); setPickerOpen(false); }}
              />
            ))}
          </AppMenu>

          <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption, marginBottom: spacing.md }}>
            {doneCount} of {tasks.length} signed off
          </Text>

          {tasksQuery.isLoading ? (
            <LoadingIndicator />
          ) : tasksQuery.error ? (
            <ErrorState onRetry={() => void tasksQuery.refetch()} />
          ) : tasks.length === 0 ? (
            <EmptyState icon="clipboard-check-outline" message="No review tasks for this period yet." />
          ) : (
            <View style={{ gap: spacing.md }}>
              {tasks.map(task => (
                <TaskCard key={task.id} task={task} theme={theme} canSignOff={canSignOff} onPatch={patch => handlePatch(task, patch)} />
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

function TaskCard({
  task, theme, canSignOff, onPatch,
}: {
  task: ReviewTask; theme: AppTheme; canSignOff: boolean;
  onPatch: (patch: { status?: ReviewTaskStatus; notes?: string | null }) => Promise<void>;
}) {
  const [notes, setNotes] = useState(task.notes ?? '');
  const [saving, setSaving] = useState(false);

  async function handleStatusChange(status: ReviewTaskStatus) {
    setSaving(true);
    try { await onPatch({ status }); } finally { setSaving(false); }
  }

  async function handleNotesBlur() {
    if (notes === (task.notes ?? '')) return;
    setSaving(true);
    try { await onPatch({ notes: notes || null }); } finally { setSaving(false); }
  }

  return (
    <AppCard style={{ padding: spacing.md, gap: spacing.sm }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.semibold, flex: 1 }}>
          {TASK_LABELS[task.task_key]}
        </Text>
        <StatusBadge
          status={task.status === 'done' ? 'green' : task.status === 'in_progress' ? 'blue' : 'gray'}
          label={task.status === 'in_progress' ? 'In progress' : task.status === 'done' ? 'Done' : 'To do'}
        />
      </View>

      <AppSegmentedControl
        value={task.status}
        onChange={status => void handleStatusChange(status)}
        options={[
          { value: 'todo', label: 'To do' },
          { value: 'in_progress', label: 'In progress' },
          { value: 'done', label: 'Done' },
        ]}
      />

      <AppTextInput
        placeholder="Notes"
        value={notes}
        onChangeText={setNotes}
        onBlur={() => void handleNotesBlur()}
        multiline
        style={{ minHeight: 60, textAlignVertical: 'top' }}
      />

      {task.signed_off_at ? (
        <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>
          Signed off {fmtShortDate(task.signed_off_at)}
        </Text>
      ) : canSignOff ? (
        <AppButton
          variant="outline"
          disabled={task.status === 'done'}
          loading={saving}
          onPress={() => void handleStatusChange('done')}
        >
          Sign off
        </AppButton>
      ) : null}
    </AppCard>
  );
}
