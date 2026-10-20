import { View, StyleSheet, ScrollView, Pressable, Linking } from 'react-native';
import { Text, Appbar, Card, useTheme } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../hooks/useAuth';
import { getCustomer, listInvoices } from '../../services/api';
import { LoadingIndicator } from '../../components/LoadingIndicator';
import { ErrorState } from '../../components/ErrorState';
import { fmtMoney, fmtShortDate } from '../../lib/money';
import { spacing, typeScale, type AppTheme } from '../../theme';

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
  const invoicesQuery = useQuery({
    queryKey: ['invoices', activeBusinessId, { customer_id: id }],
    queryFn: () => listInvoices(activeBusinessId!, { customer_id: id }),
    enabled: !!activeBusinessId,
  });

  const loading = customerQuery.isLoading;
  const customer = customerQuery.data;

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
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xxl }]}>
          <View style={styles.amountBlock}>
            <Text style={{ fontSize: typeScale.caption, color: theme.app.mutedForeground }}>Open balance</Text>
            <Text style={{ fontSize: 32, fontWeight: '700', color: theme.app.foreground, marginTop: 2 }}>
              ${fmtMoney(customer.open_balance)}
            </Text>
          </View>

          <Card style={{ backgroundColor: theme.app.surface, marginBottom: spacing.md }}>
            <Card.Content>
              {customer.company_name ? <FieldRow label="Company" value={customer.company_name} theme={theme} /> : null}
              {customer.email ? (
                <Pressable onPress={() => Linking.openURL(`mailto:${customer.email}`)}>
                  <FieldRow label="Email" value={customer.email} theme={theme} link />
                </Pressable>
              ) : null}
              {(customer.phone ?? customer.mobile) ? (
                <Pressable onPress={() => Linking.openURL(`tel:${customer.phone ?? customer.mobile}`)}>
                  <FieldRow label="Phone" value={(customer.phone ?? customer.mobile) ?? ''} theme={theme} link last />
                </Pressable>
              ) : null}
            </Card.Content>
          </Card>

          <Text style={[styles.sectionTitle, { color: theme.app.foreground }]}>Invoices</Text>
          <Card style={{ backgroundColor: theme.app.surface }}>
            <Card.Content>
              {invoicesQuery.isLoading ? (
                <LoadingIndicator size="sm" />
              ) : invoicesQuery.data?.length === 0 ? (
                <Text style={{ color: theme.app.mutedForeground }}>No invoices yet.</Text>
              ) : (
                invoicesQuery.data?.map((inv, i) => (
                  <View key={inv.id}>
                    <Pressable
                      style={({ pressed }) => [styles.invoiceRow, { opacity: pressed ? 0.6 : 1 }]}
                      onPress={() => router.push({ pathname: '/invoice/[id]', params: { id: inv.id } })}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: theme.app.foreground, fontWeight: '600' }}>#{inv.invoice_number}</Text>
                        <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>
                          Due {fmtShortDate(inv.due_date)}
                        </Text>
                      </View>
                      <Text style={{ color: theme.app.foreground, fontWeight: '700' }}>${fmtMoney(inv.total)}</Text>
                    </Pressable>
                    {i < (invoicesQuery.data?.length ?? 0) - 1 && <View style={[styles.divider, { backgroundColor: theme.app.border }]} />}
                  </View>
                ))
              )}
            </Card.Content>
          </Card>
        </ScrollView>
      )}
    </View>
  );
}

function FieldRow({ label, value, theme, last, link }: { label: string; value: string; theme: AppTheme; last?: boolean; link?: boolean }) {
  return (
    <View style={[styles.fieldRow, last && { marginBottom: 0 }]}>
      <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>{label}</Text>
      <Text style={{ color: link ? theme.app.primary : theme.app.foreground, fontWeight: '500', marginTop: 1 }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md },
  amountBlock: { alignItems: 'center', marginBottom: spacing.lg, marginTop: spacing.sm },
  sectionTitle: { fontSize: typeScale.h2, fontWeight: '700', marginBottom: spacing.sm },
  fieldRow: { marginBottom: spacing.sm },
  invoiceRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm },
  divider: { height: StyleSheet.hairlineWidth },
});
