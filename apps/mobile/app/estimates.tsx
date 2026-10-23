import { useState } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { FlashList } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../hooks/useAuth';
import { AppHeader } from '../components/AppHeader';
import { AppChip } from '../components/ui/AppChip';
import { StatusBadge, type BadgeStatus } from '../components/ui/StatusBadge';
import { listEstimates, type EstimateRow, type EstimateStatus } from '../services/api';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import { fmtMoney, fmtShortDate } from '../lib/money';
import { spacing, typeScale, fontFamily, minTouchTarget, type AppTheme } from '../theme';

const STATUS_LABELS: Record<EstimateStatus, string> = {
  pending: 'Pending', accepted: 'Accepted', rejected: 'Rejected', closed: 'Closed',
};
const STATUS_BADGES: Record<EstimateStatus, BadgeStatus> = {
  pending: 'blue', accepted: 'green', rejected: 'red', closed: 'gray',
};

export default function EstimatesScreen() {
  const theme = useTheme<AppTheme>();
  const insets = useSafeAreaInsets();
  const { activeBusinessId } = useAuth();
  const [status, setStatus] = useState<EstimateStatus | undefined>(undefined);

  const query = useQuery({
    queryKey: ['estimates', activeBusinessId, status],
    queryFn: () => listEstimates(activeBusinessId!, status ? { status } : {}),
    enabled: !!activeBusinessId,
  });

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title="Estimates" />

      <View style={styles.filterBar}>
        <AppChip label="All" active={!status} onPress={() => setStatus(undefined)} style={{ marginRight: spacing.xs }} />
        {(Object.keys(STATUS_LABELS) as EstimateStatus[]).map(s => (
          <AppChip key={s} label={STATUS_LABELS[s]} active={status === s} onPress={() => setStatus(s)} style={{ marginRight: spacing.xs }} />
        ))}
      </View>

      {query.isLoading ? (
        <LoadingIndicator />
      ) : query.error ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : (
        <FlashList
          data={query.data ?? []}
          keyExtractor={e => e.id}
          contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
          ItemSeparatorComponent={() => <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.app.border }} />}
          ListEmptyComponent={<EmptyState icon="file-document-edit-outline" message="No estimates match." />}
          renderItem={({ item }: { item: EstimateRow }) => (
            <Pressable
              style={({ pressed }) => [styles.row, { minHeight: minTouchTarget + 16, opacity: pressed ? 0.6 : 1 }]}
              onPress={() => router.push({ pathname: '/estimate/[id]', params: { id: item.id } })}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.semibold, fontSize: typeScale.body }} numberOfLines={1}>
                  {item.estimate_number} · {item.customer_name}
                </Text>
                <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }} numberOfLines={1}>
                  {fmtShortDate(item.estimate_date)}{item.expiration_date ? ` · Expires ${fmtShortDate(item.expiration_date)}` : ''}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 2 }}>
                <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.semibold, fontSize: typeScale.body }}>${fmtMoney(item.total)}</Text>
                <StatusBadge status={STATUS_BADGES[item.status]} label={STATUS_LABELS[item.status]} />
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  filterBar: { flexDirection: 'row', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.sm },
});
