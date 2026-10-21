import { useMemo, useState } from 'react';
import { View, StyleSheet, Pressable, RefreshControl } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { AppTextInput } from '../components/ui/AppTextInput';
import { AppSegmentedControl } from '../components/ui/AppSegmentedControl';
import { FlashList } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../hooks/useAuth';
import { AppHeader } from '../components/AppHeader';
import { listCustomers, listVendors, type CustomerRow, type VendorRow } from '../services/api';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import { fmtMoney } from '../lib/money';
import { spacing, typeScale, minTouchTarget, type AppTheme } from '../theme';

type Tab = 'customers' | 'vendors';

export default function ClientsScreen() {
  const theme = useTheme<AppTheme>();
  const insets = useSafeAreaInsets();
  const { activeBusinessId } = useAuth();
  // Reached from the nav drawer's Accounts Receivable > Customers or
  // Accounts Payable > Vendors — the ?tab param picks which list opens.
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<Tab>(params.tab === 'vendors' ? 'vendors' : 'customers');
  const [search, setSearch] = useState('');

  const customersQuery = useQuery({
    queryKey: ['customers', activeBusinessId],
    queryFn: () => listCustomers(activeBusinessId!),
    enabled: !!activeBusinessId && tab === 'customers',
    staleTime: 5 * 60_000, // item 7: these lists don't need feed-level freshness
  });
  const vendorsQuery = useQuery({
    queryKey: ['vendors', activeBusinessId],
    queryFn: () => listVendors(activeBusinessId!),
    enabled: !!activeBusinessId && tab === 'vendors',
    staleTime: 5 * 60_000,
  });
  const query = tab === 'customers' ? customersQuery : vendorsQuery;

  const rows = useMemo(() => {
    const items: Array<CustomerRow | VendorRow> = query.data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(c => c.name.toLowerCase().includes(q) || (c.email ?? '').toLowerCase().includes(q));
  }, [query.data, search]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title={tab === 'customers' ? 'Customers' : 'Vendors'} />

      <View style={styles.listHeader}>
        <AppSegmentedControl
          value={tab}
          onChange={setTab}
          options={[
            { value: 'customers', label: 'Customers' },
            { value: 'vendors', label: 'Vendors' },
          ]}
        />
        <AppTextInput
          placeholder={`Search ${tab}`}
          value={search}
          onChangeText={setSearch}
          containerStyle={{ marginTop: spacing.sm }}
          left={<MaterialCommunityIcons name="magnify" size={18} color={theme.app.mutedForeground} />}
        />
      </View>

      {query.isLoading ? (
        <LoadingIndicator />
      ) : query.error ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : (
        <FlashList
          data={rows}
          keyExtractor={c => c.id}
          contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
          refreshControl={<RefreshControl refreshing={query.isFetching && !query.isLoading} onRefresh={() => void query.refetch()} tintColor={theme.app.primary} />}
          ItemSeparatorComponent={() => <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.app.border }} />}
          ListEmptyComponent={<EmptyState icon="account-search-outline" message={`No ${tab} match.`} />}
          renderItem={({ item }: { item: CustomerRow | VendorRow }) => (
            <Pressable
              style={({ pressed }) => [styles.row, { minHeight: minTouchTarget + 16, opacity: pressed ? 0.6 : 1 }]}
              onPress={() => router.push(
                tab === 'customers'
                  ? { pathname: '/customer/[id]', params: { id: item.id } }
                  : { pathname: '/vendor/[id]', params: { id: item.id } },
              )}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.app.foreground, fontWeight: '600' }} numberOfLines={1}>{item.name}</Text>
                {item.email ? (
                  <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }} numberOfLines={1}>{item.email}</Text>
                ) : null}
              </View>
              <Text style={{ color: theme.app.foreground, fontWeight: '700' }}>${fmtMoney(item.open_balance)}</Text>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  listHeader: { paddingHorizontal: spacing.md, paddingTop: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
});
