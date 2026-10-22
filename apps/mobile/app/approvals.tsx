import { useState } from 'react';
import { View, StyleSheet, Alert } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { FlashList } from '@shopify/flash-list';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { hasMinRole, type Role } from '@accounting/shared';
import { useAuth } from '../hooks/useAuth';
import { AppHeader } from '../components/AppHeader';
import { AppCard } from '../components/ui/AppCard';
import { AppButton } from '../components/ui/AppButton';
import { AppChip } from '../components/ui/AppChip';
import { StatusBadge, type BadgeStatus } from '../components/ui/StatusBadge';
import { listApprovals, approveRequest, rejectRequest, type ApprovalRow, type ApprovalStatus } from '../services/api';
import { pickErr } from '../services/apiClient';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import { fmtMoney, fmtShortDate } from '../lib/money';
import { spacing, typeScale, fontFamily, type AppTheme } from '../theme';

type Filter = 'all' | ApprovalStatus;
const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: 'All' }, { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' }, { value: 'rejected', label: 'Rejected' },
];
const BADGE: Record<string, BadgeStatus> = { pending: 'blue', approving: 'blue', approved: 'green', rejected: 'red' };

/**
 * The queue CLAUDE.md's HELD_ACTIONS note describes: a staff entry that
 * posts to the ledger waits here when a business has staff entries wait
 * for an accountant. Staff sees their own requests and what became of
 * them; viewer and accountant+ see everything.
 */
export default function ApprovalsScreen() {
  const theme = useTheme<AppTheme>();
  const { activeBusinessId, businesses, user } = useAuth();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>('pending');
  const [actingId, setActingId] = useState<string | null>(null);

  const effectiveRole = (businesses.find(b => b.id === activeBusinessId)?.role_override ?? user?.role ?? 'viewer') as Role;
  const canDecide = hasMinRole(effectiveRole, 'accountant');

  const query = useQuery({
    queryKey: ['approvals', activeBusinessId, filter],
    queryFn: () => listApprovals(activeBusinessId!, filter === 'all' ? {} : { status: filter }),
    enabled: !!activeBusinessId,
  });

  async function handleApprove(id: string) {
    setActingId(id);
    try {
      await approveRequest(activeBusinessId!, id);
      await queryClient.invalidateQueries({ queryKey: ['approvals'] });
    } catch (e) {
      Alert.alert("Couldn't approve", pickErr(e));
    } finally {
      setActingId(null);
    }
  }

  function handleReject(id: string) {
    Alert.alert('Reject this request?', 'The person who submitted it will see it was turned down.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reject', style: 'destructive',
        onPress: () => {
          void (async () => {
            setActingId(id);
            try {
              await rejectRequest(activeBusinessId!, id);
              await queryClient.invalidateQueries({ queryKey: ['approvals'] });
            } catch (e) {
              Alert.alert("Couldn't reject", pickErr(e));
            } finally {
              setActingId(null);
            }
          })();
        },
      },
    ]);
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title="Approvals" />

      <View style={styles.filterBar}>
        {FILTERS.map(f => (
          <AppChip key={f.value} label={f.label} active={filter === f.value} onPress={() => setFilter(f.value)} style={{ marginRight: spacing.xs }} />
        ))}
      </View>

      {query.isLoading ? (
        <LoadingIndicator />
      ) : query.error || !query.data ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : (
        <FlashList
          data={query.data.requests}
          keyExtractor={r => r.id}
          contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xxl }}
          ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
          ListEmptyComponent={<EmptyState icon="check-decagram-outline" message="Nothing waiting." />}
          renderItem={({ item }: { item: ApprovalRow }) => (
            <RequestCard
              row={item} theme={theme} canDecide={canDecide}
              acting={actingId === item.id}
              onApprove={() => void handleApprove(item.id)}
              onReject={() => handleReject(item.id)}
            />
          )}
        />
      )}
    </View>
  );
}

function RequestCard({
  row, theme, canDecide, acting, onApprove, onReject,
}: { row: ApprovalRow; theme: AppTheme; canDecide: boolean; acting: boolean; onApprove: () => void; onReject: () => void }) {
  const status = row.status === 'approving' ? 'pending' : row.status;
  return (
    <AppCard style={{ padding: spacing.md }}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.semibold }} numberOfLines={2}>{row.summary}</Text>
          <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>{fmtShortDate(row.created_at)}</Text>
        </View>
        <StatusBadge status={BADGE[row.status] ?? 'gray'} label={status} />
      </View>
      {row.amount ? (
        <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.bold, fontSize: typeScale.h3, marginTop: spacing.xs }}>
          ${fmtMoney(row.amount)}
        </Text>
      ) : null}
      {row.decision_note ? (
        <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption, marginTop: spacing.xs }}>
          "{row.decision_note}"
        </Text>
      ) : null}
      {canDecide && status === 'pending' ? (
        <View style={styles.actionsRow}>
          <AppButton variant="destructive" onPress={onReject} loading={acting} style={{ flex: 1 }}>Reject</AppButton>
          <AppButton onPress={onApprove} loading={acting} style={{ flex: 1 }}>Approve</AppButton>
        </View>
      ) : null}
    </AppCard>
  );
}

const styles = StyleSheet.create({
  filterBar: { flexDirection: 'row', paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  actionsRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
});
