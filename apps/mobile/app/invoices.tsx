import { useMemo, useState } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text, Appbar, Chip, useTheme } from 'react-native-paper';
import { FlashList } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../hooks/useAuth';
import { listInvoices, listCustomers, type InvoiceRow } from '../services/api';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { ErrorState } from '../components/ErrorState';
import { fmtMoney, fmtShortDate } from '../lib/money';
import { spacing, typeScale, minTouchTarget, type AppTheme } from '../theme';

type StatusFilter = 'all' | 'open' | 'overdue' | 'paid';
const FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'All' }, { value: 'open', label: 'Open' },
  { value: 'overdue', label: 'Overdue' }, { value: 'paid', label: 'Paid' },
];
const todayIso = () => new Date().toISOString().slice(0, 10);

export default function InvoicesScreen() {
  const theme = useTheme<AppTheme>();
  const insets = useSafeAreaInsets();
  const { activeBusinessId } = useAuth();
  const [filter, setFilter] = useState<StatusFilter>('all');

  const invoicesQuery = useQuery({
    queryKey: ['invoices', activeBusinessId],
    queryFn: () => listInvoices(activeBusinessId!),
    enabled: !!activeBusinessId,
    staleTime: 5 * 60_000,
  });
  const customersQuery = useQuery({
    queryKey: ['customers', activeBusinessId],
    queryFn: () => listCustomers(activeBusinessId!),
    enabled: !!activeBusinessId,
    staleTime: 5 * 60_000,
  });

  // Invoices don't carry a customer name — join client-side against the
  // customer list, same pattern the web InvoiceListPage uses.
  const customerNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of customersQuery.data ?? []) m.set(c.id, c.name);
    return m;
  }, [customersQuery.data]);

  const rows = useMemo(() => {
    const items = invoicesQuery.data ?? [];
    const today = todayIso();
    switch (filter) {
      case 'open': return items.filter(i => i.status === 'posted');
      case 'overdue': return items.filter(i => i.status === 'posted' && i.due_date < today);
      case 'paid': return items.filter(i => i.status === 'paid');
      default: return items;
    }
  }, [invoicesQuery.data, filter]);

  const loading = invoicesQuery.isLoading || customersQuery.isLoading;
  const anyError = invoicesQuery.error ?? customersQuery.error;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <Appbar.Header statusBarHeight={insets.top} style={{ backgroundColor: theme.app.surface }}>
        <Appbar.BackAction onPress={() => router.back()} color={theme.app.foreground} />
        <Appbar.Content title="Invoices" titleStyle={{ color: theme.app.foreground }} />
      </Appbar.Header>

      <View style={styles.filterBar}>
        {FILTERS.map(f => (
          <Chip
            key={f.value}
            selected={filter === f.value}
            onPress={() => setFilter(f.value)}
            style={{ marginRight: spacing.xs }}
            selectedColor={theme.app.primary}
          >
            {f.label}
          </Chip>
        ))}
      </View>

      {loading ? (
        <LoadingIndicator />
      ) : anyError ? (
        <ErrorState onRetry={() => { void invoicesQuery.refetch(); void customersQuery.refetch(); }} />
      ) : (
        <FlashList
          data={rows}
          keyExtractor={i => i.id}
          contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
          ItemSeparatorComponent={() => <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.app.border }} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={{ color: theme.app.mutedForeground }}>No invoices match.</Text>
            </View>
          }
          renderItem={({ item }: { item: InvoiceRow }) => (
            <InvoiceRowItem row={item} customerName={customerNames.get(item.customer_id)} theme={theme} />
          )}
        />
      )}
    </View>
  );
}

function InvoiceRowItem({ row, customerName, theme }: { row: InvoiceRow; customerName: string | undefined; theme: AppTheme }) {
  const overdue = row.status === 'posted' && row.due_date < todayIso();
  return (
    <Pressable
      style={({ pressed }) => [styles.row, { minHeight: minTouchTarget + 16, opacity: pressed ? 0.6 : 1 }]}
      onPress={() => router.push({ pathname: '/invoice/[id]', params: { id: row.id } })}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.app.foreground, fontWeight: '600' }} numberOfLines={1}>
          {customerName ?? 'Customer'} · #{row.invoice_number}
        </Text>
        <Text style={{ color: overdue ? theme.app.statusRedFg : theme.app.mutedForeground, fontSize: typeScale.caption }}>
          Due {fmtShortDate(row.due_date)}{overdue ? ' · Overdue' : ''}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={{ color: theme.app.foreground, fontWeight: '700' }}>${fmtMoney(row.total)}</Text>
        <StatusPill status={row.status} theme={theme} />
      </View>
    </Pressable>
  );
}

function StatusPill({ status, theme }: { status: string; theme: AppTheme }) {
  const map: Record<string, { bg: string; fg: string }> = {
    posted: { bg: theme.app.statusBlueBg, fg: theme.app.statusBlueFg },
    paid: { bg: theme.app.statusGreenBg, fg: theme.app.statusGreenFg },
    draft: { bg: theme.app.statusGrayBg, fg: theme.app.statusGrayFg },
    voided: { bg: theme.app.statusRedBg, fg: theme.app.statusRedFg },
  };
  const c = map[status] ?? { bg: theme.app.statusGrayBg, fg: theme.app.statusGrayFg };
  return (
    <View style={{ backgroundColor: c.bg, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, marginTop: 2 }}>
      <Text style={{ color: c.fg, fontSize: 10, fontWeight: '600', textTransform: 'capitalize' }}>{status}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  filterBar: { flexDirection: 'row', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  empty: { alignItems: 'center', paddingTop: spacing.xxl },
});
