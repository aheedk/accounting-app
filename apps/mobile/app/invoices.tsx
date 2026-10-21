import { useMemo, useState } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { AppChip } from '../components/ui/AppChip';
import { FlashList } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../hooks/useAuth';
import { AppHeader } from '../components/AppHeader';
import { StatusBadge, type BadgeStatus } from '../components/ui/StatusBadge';
import { listInvoices, listCustomers, type InvoiceRow } from '../services/api';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import { fmtMoney, fmtShortDate } from '../lib/money';
import { spacing, typeScale, fontFamily, minTouchTarget, type AppTheme } from '../theme';

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
      <AppHeader title="Invoices" />

      <View style={styles.filterBar}>
        {FILTERS.map(f => (
          <AppChip
            key={f.value}
            label={f.label}
            active={filter === f.value}
            onPress={() => setFilter(f.value)}
            style={{ marginRight: spacing.xs }}
          />
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
          ListEmptyComponent={<EmptyState icon="file-document-outline" message="No invoices match." />}
          renderItem={({ item }: { item: InvoiceRow }) => (
            <InvoiceRowItem row={item} customerName={customerNames.get(item.customer_id)} theme={theme} />
          )}
        />
      )}
    </View>
  );
}

// Invoice status is its own vocabulary, distinct from the transaction/JE
// posted=green convention elsewhere — "posted" here means open/unpaid
// (blue, same as Imported elsewhere), not settled.
const INVOICE_BADGE: Record<string, BadgeStatus> = { posted: 'blue', paid: 'green', draft: 'gray', voided: 'red' };

function InvoiceRowItem({ row, customerName, theme }: { row: InvoiceRow; customerName: string | undefined; theme: AppTheme }) {
  const overdue = row.status === 'posted' && row.due_date < todayIso();
  return (
    <Pressable
      style={({ pressed }) => [styles.row, { minHeight: minTouchTarget + 16, opacity: pressed ? 0.6 : 1 }]}
      onPress={() => router.push({ pathname: '/invoice/[id]', params: { id: row.id } })}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.semibold, fontSize: typeScale.body }} numberOfLines={1}>
          {customerName ?? 'Customer'} · #{row.invoice_number}
        </Text>
        <Text style={{ color: overdue ? theme.app.statusRedFg : theme.app.mutedForeground, fontSize: typeScale.caption }}>
          Due {fmtShortDate(row.due_date)}{overdue ? ' · Overdue' : ''}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 2 }}>
        <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.semibold, fontSize: typeScale.body }}>${fmtMoney(row.total)}</Text>
        <StatusBadge status={INVOICE_BADGE[row.status] ?? 'gray'} label={row.status} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  filterBar: { flexDirection: 'row', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
});
