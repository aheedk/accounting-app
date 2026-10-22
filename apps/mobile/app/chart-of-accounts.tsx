import { useMemo, useState } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../hooks/useAuth';
import { AppHeader } from '../components/AppHeader';
import { AppTextInput } from '../components/ui/AppTextInput';
import { AppChip } from '../components/ui/AppChip';
import { AppMenu, AppMenuItem } from '../components/ui/AppMenu';
import { StatusBadge } from '../components/ui/StatusBadge';
import { listChartOfAccounts, type CoaAccount } from '../services/api';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import { spacing, typeScale, fontFamily, minTouchTarget, type AppTheme } from '../theme';

type TypeFilter = 'all' | 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
const TYPE_FILTERS: Array<{ value: TypeFilter; label: string }> = [
  { value: 'all', label: 'All' }, { value: 'asset', label: 'Asset' }, { value: 'liability', label: 'Liability' },
  { value: 'equity', label: 'Equity' }, { value: 'revenue', label: 'Revenue' }, { value: 'expense', label: 'Expense' },
];

type StatusFilter = 'active' | 'inactive' | 'all';
const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }, { value: 'all', label: 'All' },
];

/**
 * Same account list as web's CoaListPage.tsx (flat, sorted by code, a type
 * filter rather than grouped sections — web doesn't group this list either,
 * unlike Balance Sheet) — read-only on mobile: no create/edit form, since
 * those are accountant-gated and this is reference/lookup, same as GL.
 */
export default function ChartOfAccountsScreen() {
  const theme = useTheme<AppTheme>();
  const insets = useSafeAreaInsets();
  const { activeBusinessId } = useAuth();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);

  const query = useQuery({
    queryKey: ['coa-full', activeBusinessId, statusFilter],
    queryFn: () => listChartOfAccounts(activeBusinessId!, { include_inactive: statusFilter !== 'active' }),
    enabled: !!activeBusinessId,
  });

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (query.data ?? []).filter(a => {
      if (typeFilter !== 'all' && a.account_type !== typeFilter) return false;
      if (statusFilter === 'active' && !a.is_active) return false;
      if (statusFilter === 'inactive' && a.is_active) return false;
      if (q && !a.name.toLowerCase().includes(q) && !a.code.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [query.data, search, typeFilter, statusFilter]);

  const typeLabel = TYPE_FILTERS.find(f => f.value === typeFilter)?.label ?? 'All';
  const statusLabel = STATUS_FILTERS.find(f => f.value === statusFilter)?.label ?? 'Active';

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title="Chart of Accounts" />

      <View style={styles.filterBar}>
        <AppTextInput
          placeholder="Filter by name or number"
          value={search}
          onChangeText={setSearch}
          containerStyle={{ marginBottom: spacing.sm }}
          left={<MaterialCommunityIcons name="magnify" size={18} color={theme.app.mutedForeground} />}
        />
        <View style={styles.chipRow}>
          <AppMenu
            visible={typeMenuOpen}
            onDismiss={() => setTypeMenuOpen(false)}
            anchor={<AppChip icon="chevron-down" label={typeLabel} onPress={() => setTypeMenuOpen(true)} style={{ marginRight: spacing.xs }} />}
          >
            {TYPE_FILTERS.map(f => (
              <AppMenuItem
                key={f.value} title={f.label}
                trailingIcon={typeFilter === f.value ? 'check' : undefined}
                onPress={() => { setTypeFilter(f.value); setTypeMenuOpen(false); }}
              />
            ))}
          </AppMenu>
          <AppMenu
            visible={statusMenuOpen}
            onDismiss={() => setStatusMenuOpen(false)}
            anchor={<AppChip icon="chevron-down" label={statusLabel} onPress={() => setStatusMenuOpen(true)} />}
          >
            {STATUS_FILTERS.map(f => (
              <AppMenuItem
                key={f.value} title={f.label}
                trailingIcon={statusFilter === f.value ? 'check' : undefined}
                onPress={() => { setStatusFilter(f.value); setStatusMenuOpen(false); }}
              />
            ))}
          </AppMenu>
        </View>
      </View>

      {query.isLoading ? (
        <LoadingIndicator />
      ) : query.error ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : (
        <FlashList
          data={rows}
          keyExtractor={a => a.id}
          contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
          ItemSeparatorComponent={() => <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.app.border }} />}
          ListEmptyComponent={<EmptyState icon="book-open-outline" message="No accounts match." />}
          renderItem={({ item }: { item: CoaAccount }) => <AccountRow account={item} theme={theme} />}
        />
      )}
    </View>
  );
}

function AccountRow({ account, theme }: { account: CoaAccount; theme: AppTheme }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.row, { minHeight: minTouchTarget + 10, opacity: pressed ? 0.6 : 1 }]}
      onPress={() => router.push({ pathname: '/account/[id]', params: { id: account.id } })}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ color: account.is_active ? theme.app.foreground : theme.app.mutedForeground, fontFamily: fontFamily.semibold, fontSize: typeScale.body }} numberOfLines={1}>
          {account.code} — {account.name}
        </Text>
        <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption, textTransform: 'capitalize' }} numberOfLines={1}>
          {account.account_type}{account.detail_type ? ` · ${account.detail_type}` : ''}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        {account.is_locked ? <MaterialCommunityIcons name="lock-outline" size={14} color={theme.app.mutedForeground} /> : null}
        <StatusBadge status={account.is_active ? 'green' : 'gray'} label={account.is_active ? 'Active' : 'Inactive'} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  filterBar: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
});
