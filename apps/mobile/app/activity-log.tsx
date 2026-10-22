import { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { FlashList } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { hasMinRole, type Role } from '@accounting/shared';
import { useAuth } from '../hooks/useAuth';
import { AppHeader } from '../components/AppHeader';
import { AppButton } from '../components/ui/AppButton';
import { listActivityLog, type ActivityLogRow } from '../services/api';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import { fmtShortDate } from '../lib/money';
import { spacing, typeScale, fontFamily, type AppTheme } from '../theme';

function actionLabel(action: string): string {
  return action.replace(/[._]/g, ' ');
}

/** Read-only audit viewer — no writes exist for this entity. Cursor-
 * paginated by created_at; a "Load more" button appends rather than an
 * infinite-scroll trigger, matching this app's established preference
 * for explicit pagination over auto-fetch-on-scroll. */
export default function ActivityLogScreen() {
  const theme = useTheme<AppTheme>();
  const { activeBusinessId, businesses, user } = useAuth();
  const [rows, setRows] = useState<ActivityLogRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const effectiveRole = (businesses.find(b => b.id === activeBusinessId)?.role_override ?? user?.role ?? 'viewer') as Role;
  const canView = hasMinRole(effectiveRole, 'accountant');

  const query = useQuery({
    queryKey: ['activity-log', activeBusinessId],
    queryFn: async () => {
      const r = await listActivityLog(activeBusinessId!);
      setRows(r.rows);
      setHasMore(r.has_more);
      return r;
    },
    enabled: !!activeBusinessId && canView,
  });

  async function loadMore() {
    if (!hasMore || loadingMore || rows.length === 0) return;
    setLoadingMore(true);
    try {
      const next = await listActivityLog(activeBusinessId!, { before: rows[rows.length - 1]!.created_at });
      setRows(prev => [...prev, ...next.rows]);
      setHasMore(next.has_more);
    } finally {
      setLoadingMore(false);
    }
  }

  if (!canView) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <AppHeader title="Activity Log" />
        <View style={{ padding: spacing.lg, alignItems: 'center' }}>
          <Text style={{ color: theme.app.mutedForeground, textAlign: 'center' }}>
            Your role doesn't have permission to view the activity log.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title="Activity Log" />

      {query.isLoading ? (
        <LoadingIndicator />
      ) : query.error ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : (
        <FlashList
          data={rows}
          keyExtractor={r => r.id}
          contentContainerStyle={{ paddingBottom: spacing.xxl }}
          ItemSeparatorComponent={() => <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.app.border }} />}
          ListEmptyComponent={<EmptyState icon="history" message="No activity recorded yet." />}
          renderItem={({ item }: { item: ActivityLogRow }) => (
            <View style={styles.row}>
              <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.medium }} numberOfLines={1}>
                {actionLabel(item.action)}
              </Text>
              <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>
                {item.user_name ?? 'System'} · {fmtShortDate(item.created_at)} · {item.entity_type}
              </Text>
            </View>
          )}
          ListFooterComponent={
            hasMore ? (
              <View style={{ padding: spacing.md }}>
                <AppButton variant="outline" onPress={() => void loadMore()} loading={loadingMore}>Load more</AppButton>
              </View>
            ) : null
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
});
