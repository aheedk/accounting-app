import { useMemo, useState } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text, List, TextInput, Menu, Divider, useTheme } from 'react-native-paper';
import { FlashList } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../hooks/useAuth';
import { listCustomers, type CustomerRow } from '../../services/api';
import { LoadingIndicator } from '../../components/LoadingIndicator';
import { ErrorState } from '../../components/ErrorState';
import { fmtMoney } from '../../lib/money';
import { spacing, typeScale, minTouchTarget, type AppTheme } from '../../theme';

export default function ClientsScreen() {
  const theme = useTheme<AppTheme>();
  const insets = useSafeAreaInsets();
  const { businesses, activeBusinessId, setActiveBusinessId } = useAuth();
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [search, setSearch] = useState('');
  const activeBusiness = businesses.find(b => b.id === activeBusinessId);

  const query = useQuery({
    queryKey: ['customers', activeBusinessId],
    queryFn: () => listCustomers(activeBusinessId!),
    enabled: !!activeBusinessId,
    staleTime: 5 * 60_000, // item 7: customer list doesn't need feed-level freshness
  });

  const rows = useMemo(() => {
    const items = query.data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(c => c.name.toLowerCase().includes(q) || (c.email ?? '').toLowerCase().includes(q));
  }, [query.data, search]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background, paddingTop: insets.top }}>
      <View style={styles.header}>
        <Text style={{ fontSize: typeScale.h1, fontWeight: '700', color: theme.app.foreground }}>Clients</Text>
      </View>

      <Menu
        visible={switcherOpen}
        onDismiss={() => setSwitcherOpen(false)}
        anchor={
          <List.Item
            title={activeBusiness?.name ?? 'Pick a business'}
            description="Tap to switch business"
            onPress={() => setSwitcherOpen(true)}
            left={props => <List.Icon {...props} icon="domain" color={theme.app.primary} />}
            right={props => <List.Icon {...props} icon="chevron-down" color={theme.app.mutedForeground} />}
            titleStyle={{ color: theme.app.foreground, fontWeight: '700' }}
            descriptionStyle={{ color: theme.app.mutedForeground }}
          />
        }
      >
        {businesses.map(b => (
          <Menu.Item
            key={b.id}
            title={b.name}
            onPress={() => { setActiveBusinessId(b.id); setSwitcherOpen(false); }}
            trailingIcon={b.id === activeBusinessId ? 'check' : undefined}
          />
        ))}
      </Menu>

      <List.Item
        title="Invoices"
        onPress={() => router.push('/invoices')}
        left={props => <List.Icon {...props} icon="file-document-outline" color={theme.app.foreground} />}
        titleStyle={{ color: theme.app.foreground }}
      />
      <Divider style={{ marginBottom: spacing.sm }} />

      <View style={styles.customersHeader}>
        <Text style={{ fontSize: typeScale.h2, fontWeight: '700', color: theme.app.foreground }}>Customers</Text>
        <TextInput
          mode="outlined"
          placeholder="Search customers"
          value={search}
          onChangeText={setSearch}
          dense
          style={{ marginTop: spacing.sm, backgroundColor: theme.app.surface }}
          left={<TextInput.Icon icon="magnify" />}
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
          ItemSeparatorComponent={() => <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.app.border }} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={{ color: theme.app.mutedForeground }}>No customers match.</Text>
            </View>
          }
          renderItem={({ item }: { item: CustomerRow }) => (
            <Pressable
              style={({ pressed }) => [styles.row, { minHeight: minTouchTarget + 16, opacity: pressed ? 0.6 : 1 }]}
              onPress={() => router.push({ pathname: '/customer/[id]', params: { id: item.id } })}
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
  header: { padding: spacing.md, paddingBottom: 0 },
  customersHeader: { paddingHorizontal: spacing.md, paddingTop: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  empty: { alignItems: 'center', paddingTop: spacing.xxl },
});
