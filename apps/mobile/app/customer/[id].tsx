import { useMemo } from 'react';
import { View, StyleSheet, ScrollView, Pressable, Linking, RefreshControl } from 'react-native';
import { Text, Appbar, useTheme } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../hooks/useAuth';
import { getCustomer, listCustomers, listInvoices, type Address, type InvoiceRow } from '../../services/api';
import { LoadingIndicator } from '../../components/LoadingIndicator';
import { ErrorState } from '../../components/ErrorState';
import { EmptyState } from '../../components/EmptyState';
import { AppCard } from '../../components/ui/AppCard';
import { StatusBadge, type BadgeStatus } from '../../components/ui/StatusBadge';
import { fmtMoney, fmtShortDate } from '../../lib/money';
import { spacing, typeScale, fontFamily, type AppTheme } from '../../theme';

const todayIso = () => new Date().toISOString().slice(0, 10);

function fmtAddress(a: Address): string {
  if (!a) return '';
  const cityLine = [a.city, a.state, a.postal_code].filter(Boolean).join(', ');
  return [a.line1, a.line2, cityLine, a.country].filter(Boolean).join('\n');
}

function termsLabel(days: number): string {
  return days === 0 ? 'Due on receipt' : `Net ${days}`;
}

const INVOICE_BADGE: Record<string, BadgeStatus> = { posted: 'blue', paid: 'green', draft: 'gray', voided: 'red' };

export default function CustomerDetailScreen() {
  const theme = useTheme<AppTheme>();
  const insets = useSafeAreaInsets();
  const { activeBusinessId } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();

  const customerQuery = useQuery({
    queryKey: ['customer', activeBusinessId, id],
    queryFn: () => getCustomer(activeBusinessId!, id),
    enabled: !!activeBusinessId,
  });
  // GET /customers/:id doesn't return open_balance (list-only, computed
  // field) — pull it from the list query instead, which the Clients tab has
  // usually already cached.
  const customersListQuery = useQuery({
    queryKey: ['customers', activeBusinessId],
    queryFn: () => listCustomers(activeBusinessId!),
    enabled: !!activeBusinessId,
    staleTime: 5 * 60_000,
  });
  const invoicesQuery = useQuery({
    queryKey: ['invoices', activeBusinessId, { customer_id: id }],
    queryFn: () => listInvoices(activeBusinessId!, { customer_id: id }),
    enabled: !!activeBusinessId,
  });

  // Same Open/Overdue/Paid breakdown as web's CustomerDetailPage, computed
  // client-side from the same invoice list (no separate stats endpoint).
  const stats = useMemo(() => {
    const today = todayIso();
    let open = 0, overdue = 0, paid = 0;
    for (const i of invoicesQuery.data ?? []) {
      const amount = parseFloat(i.total);
      if (i.status === 'posted') { if (i.due_date < today) overdue += amount; else open += amount; }
      else if (i.status === 'paid') paid += amount;
    }
    return { open, overdue, paid };
  }, [invoicesQuery.data]);

  const loading = customerQuery.isLoading;
  const customer = customerQuery.data;
  const refreshing = customerQuery.isFetching || customersListQuery.isFetching || invoicesQuery.isFetching;
  function refresh() {
    void customerQuery.refetch();
    void customersListQuery.refetch();
    void invoicesQuery.refetch();
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <Appbar.Header statusBarHeight={insets.top} style={{ backgroundColor: theme.app.surface }}>
        <Appbar.BackAction onPress={() => router.back()} color={theme.app.foreground} />
        <Appbar.Content title={customer?.name ?? 'Customer'} titleStyle={{ color: theme.app.foreground }} />
      </Appbar.Header>

      {loading ? (
        <LoadingIndicator />
      ) : customerQuery.error || !customer ? (
        <ErrorState onRetry={() => void customerQuery.refetch()} />
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xxl }]}
          refreshControl={<RefreshControl refreshing={!loading && refreshing} onRefresh={refresh} tintColor={theme.app.primary} />}
        >
          <View style={styles.amountBlock}>
            <Text style={{ fontSize: typeScale.caption, color: theme.app.mutedForeground }}>Open balance</Text>
            <Text style={{ fontSize: 32, fontFamily: fontFamily.bold, color: theme.app.foreground, marginTop: 2 }}>
              ${fmtMoney(stats.open + stats.overdue)}
            </Text>
          </View>

          <View style={styles.metricsRow}>
            <Metric theme={theme} label="Open" value={stats.open} />
            <Metric theme={theme} label="Overdue" value={stats.overdue} tint={theme.app.statusRedFg} />
            <Metric theme={theme} label="Paid" value={stats.paid} tint={theme.app.statusGreenFg} />
          </View>

          <SectionTitle theme={theme} text="Contact" />
          <AppCard style={{ marginBottom: spacing.md, padding: spacing.md }}>
            {customer.company_name ? <FieldRow label="Company" value={customer.company_name} theme={theme} /> : null}
            <FieldRow label="Terms" value={termsLabel(customer.default_terms_days)} theme={theme} />
            {customer.email ? (
              <Pressable onPress={() => Linking.openURL(`mailto:${customer.email}`)}>
                <FieldRow label="Email" value={customer.email} theme={theme} link />
              </Pressable>
            ) : null}
            {(customer.phone ?? customer.mobile) ? (
              <Pressable onPress={() => Linking.openURL(`tel:${customer.phone ?? customer.mobile}`)}>
                <FieldRow label="Phone" value={(customer.phone ?? customer.mobile) ?? ''} theme={theme} link />
              </Pressable>
            ) : null}
            {customer.website ? (
              <Pressable onPress={() => Linking.openURL(customer.website!)}>
                <FieldRow label="Website" value={customer.website} theme={theme} link />
              </Pressable>
            ) : null}
            {customer.opening_balance ? (
              <FieldRow
                label="Opening balance"
                value={`$${fmtMoney(customer.opening_balance)}${customer.opening_balance_as_of ? ` as of ${fmtShortDate(customer.opening_balance_as_of)}` : ''}`}
                theme={theme}
              />
            ) : null}
            {fmtAddress(customer.billing_address) ? <FieldRow label="Billing address" value={fmtAddress(customer.billing_address)} theme={theme} /> : null}
            {fmtAddress(customer.shipping_address) ? <FieldRow label="Shipping address" value={fmtAddress(customer.shipping_address)} theme={theme} /> : null}
            {customer.notes ? <FieldRow label="Notes" value={customer.notes} theme={theme} last /> : null}
          </AppCard>

          <SectionTitle theme={theme} text="Activity" />
          <AppCard style={{ marginBottom: spacing.md, padding: spacing.md }}>
            <FieldRow label="Created" value={customer.created_at ? fmtShortDate(customer.created_at) : '—'} theme={theme} />
            <FieldRow label="Last updated" value={customer.updated_at ? fmtShortDate(customer.updated_at) : '—'} theme={theme} />
            <FieldRow label="Invoices" value={`${invoicesQuery.data?.length ?? 0} total`} theme={theme} last />
          </AppCard>

          <SectionTitle theme={theme} text="Invoices" />
          <AppCard>
            {invoicesQuery.isLoading ? (
              <LoadingIndicator size="sm" />
            ) : invoicesQuery.data?.length === 0 ? (
              <EmptyState icon="file-document-outline" message="No invoices yet." compact />
            ) : (
              invoicesQuery.data?.map((inv: InvoiceRow, i) => (
                <View key={inv.id}>
                  <Pressable
                    style={({ pressed }) => [styles.invoiceRow, { opacity: pressed ? 0.6 : 1 }]}
                    onPress={() => router.push({ pathname: '/invoice/[id]', params: { id: inv.id } })}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.semibold, fontSize: typeScale.body }}>#{inv.invoice_number}</Text>
                      <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>
                        {fmtShortDate(inv.issue_date)} · Due {fmtShortDate(inv.due_date)}
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 2 }}>
                      <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.semibold, fontSize: typeScale.body }}>${fmtMoney(inv.total)}</Text>
                      <StatusBadge status={INVOICE_BADGE[inv.status] ?? 'gray'} label={inv.status} />
                    </View>
                  </Pressable>
                  {i < (invoicesQuery.data?.length ?? 0) - 1 && <View style={[styles.divider, { backgroundColor: theme.app.border }]} />}
                </View>
              ))
            )}
          </AppCard>
        </ScrollView>
      )}
    </View>
  );
}

function Metric({ theme, label, value, tint }: { theme: AppTheme; label: string; value: number; tint?: string }) {
  return (
    <AppCard style={styles.metricCard}>
      <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption, fontFamily: fontFamily.medium }}>{label}</Text>
      <Text style={{ color: tint ?? theme.app.foreground, fontSize: typeScale.h3, fontFamily: fontFamily.bold, marginTop: 2 }}>${fmtMoney(value)}</Text>
    </AppCard>
  );
}

function SectionTitle({ theme, text }: { theme: AppTheme; text: string }) {
  return <Text style={{ fontSize: typeScale.h3, fontFamily: fontFamily.semibold, color: theme.app.foreground, marginBottom: spacing.sm }}>{text}</Text>;
}

function FieldRow({ label, value, theme, last, link }: { label: string; value: string; theme: AppTheme; last?: boolean; link?: boolean }) {
  return (
    <View style={[styles.fieldRow, last && { marginBottom: 0 }]}>
      <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>{label}</Text>
      <Text style={{ color: link ? theme.app.primary : theme.app.foreground, fontFamily: fontFamily.medium, marginTop: 1 }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md },
  amountBlock: { alignItems: 'center', marginBottom: spacing.md, marginTop: spacing.sm },
  metricsRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  metricCard: { flex: 1, padding: spacing.sm },
  fieldRow: { marginBottom: spacing.sm },
  invoiceRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm },
  divider: { height: StyleSheet.hairlineWidth },
});
