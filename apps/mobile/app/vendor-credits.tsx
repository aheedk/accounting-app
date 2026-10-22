import { useMemo, useState } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { AppChip } from '../components/ui/AppChip';
import { FlashList } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { hasMinRole, type Role } from '@accounting/shared';
import { useAuth } from '../hooks/useAuth';
import { AppHeader } from '../components/AppHeader';
import { StatusBadge, type BadgeStatus } from '../components/ui/StatusBadge';
import { listVendorCredits, listVendors, type VendorCreditRow } from '../services/api';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import { fmtMoney, fmtShortDate } from '../lib/money';
import { spacing, typeScale, fontFamily, minTouchTarget, type AppTheme } from '../theme';

// Vendor-side mirror of credit-memos.tsx.
type StatusFilter = 'all' | 'draft' | 'posted' | 'applied' | 'voided';
const FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'All' }, { value: 'posted', label: 'Posted' },
  { value: 'applied', label: 'Applied' }, { value: 'draft', label: 'Draft' }, { value: 'voided', label: 'Voided' },
];

export default function VendorCreditsScreen() {
  const theme = useTheme<AppTheme>();
  const insets = useSafeAreaInsets();
  const { activeBusinessId, businesses, user } = useAuth();
  const [filter, setFilter] = useState<StatusFilter>('all');

  const creditsQuery = useQuery({
    queryKey: ['vendor-credits', activeBusinessId],
    queryFn: () => listVendorCredits(activeBusinessId!),
    enabled: !!activeBusinessId,
  });
  const vendorsQuery = useQuery({
    queryKey: ['vendors', activeBusinessId],
    queryFn: () => listVendors(activeBusinessId!),
    enabled: !!activeBusinessId,
    staleTime: 5 * 60_000,
  });

  const vendorNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const v of vendorsQuery.data ?? []) m.set(v.id, v.name);
    return m;
  }, [vendorsQuery.data]);

  const rows = useMemo(() => {
    const items = creditsQuery.data ?? [];
    return filter === 'all' ? items : items.filter(c => c.status === filter);
  }, [creditsQuery.data, filter]);

  const loading = creditsQuery.isLoading || vendorsQuery.isLoading;
  const anyError = creditsQuery.error ?? vendorsQuery.error;
  // Vendor credit creation is accountant+ server-side, same gate as
  // credit-memos.tsx uses for the AR side.
  const effectiveRole = (businesses.find(b => b.id === activeBusinessId)?.role_override ?? user?.role ?? 'viewer') as Role;
  const canCreate = hasMinRole(effectiveRole, 'accountant');

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title="Vendor Credits" />

      <View style={styles.filterBar}>
        <View style={styles.chipRow}>
          {FILTERS.map(f => (
            <AppChip key={f.value} label={f.label} active={filter === f.value} onPress={() => setFilter(f.value)} style={{ marginRight: spacing.xs, marginBottom: spacing.xs }} />
          ))}
        </View>
        {canCreate ? (
          <Pressable style={[styles.addButton, { backgroundColor: theme.app.primary }]} onPress={() => router.push('/vendor-credit/new')}>
            <MaterialCommunityIcons name="plus" size={18} color={theme.app.primaryForeground} />
            <Text style={{ color: theme.app.primaryForeground, fontFamily: fontFamily.semibold, fontSize: typeScale.body }}>New vendor credit</Text>
          </Pressable>
        ) : null}
      </View>

      {loading ? (
        <LoadingIndicator />
      ) : anyError ? (
        <ErrorState onRetry={() => { void creditsQuery.refetch(); void vendorsQuery.refetch(); }} />
      ) : (
        <FlashList
          data={rows}
          keyExtractor={c => c.id}
          contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
          ItemSeparatorComponent={() => <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.app.border }} />}
          ListEmptyComponent={<EmptyState icon="file-document-outline" message="No vendor credits match." />}
          renderItem={({ item }: { item: VendorCreditRow }) => (
            <CreditRowItem row={item} vendorName={vendorNames.get(item.vendor_id)} theme={theme} />
          )}
        />
      )}
    </View>
  );
}

const VC_BADGE: Record<string, BadgeStatus> = { posted: 'blue', applied: 'green', draft: 'gray', voided: 'red' };

function CreditRowItem({ row, vendorName, theme }: { row: VendorCreditRow; vendorName: string | undefined; theme: AppTheme }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.row, { minHeight: minTouchTarget + 16, opacity: pressed ? 0.6 : 1 }]}
      onPress={() => router.push({ pathname: '/vendor-credit/[id]', params: { id: row.id } })}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.semibold, fontSize: typeScale.body }} numberOfLines={1}>
          {vendorName ?? 'Vendor'}{row.vendor_credit_number ? ` · ${row.vendor_credit_number}` : ''}
        </Text>
        <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>
          {fmtShortDate(row.credit_date)}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 2 }}>
        <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.semibold, fontSize: typeScale.body }}>${fmtMoney(row.amount)}</Text>
        <StatusBadge status={VC_BADGE[row.status] ?? 'gray'} label={row.status} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  filterBar: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.sm, gap: spacing.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap' },
  addButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    minHeight: minTouchTarget - 4, borderRadius: 6,
  },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
});
