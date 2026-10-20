import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, Appbar, Card, Button, useTheme } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../hooks/useAuth';
import { getInvoice, getCustomer } from '../../services/api';
import { LoadingIndicator } from '../../components/LoadingIndicator';
import { ErrorState } from '../../components/ErrorState';
import { fmtMoney, fmtShortDate } from '../../lib/money';
import { spacing, typeScale, minTouchTarget, type AppTheme } from '../../theme';

export default function InvoiceDetailScreen() {
  const theme = useTheme<AppTheme>();
  const insets = useSafeAreaInsets();
  const { activeBusinessId } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();

  const invoiceQuery = useQuery({
    queryKey: ['invoice', activeBusinessId, id],
    queryFn: () => getInvoice(activeBusinessId!, id),
    enabled: !!activeBusinessId,
  });
  const customerId = invoiceQuery.data?.invoice.customer_id;
  const customerQuery = useQuery({
    queryKey: ['customer', activeBusinessId, customerId],
    queryFn: () => getCustomer(activeBusinessId!, customerId!),
    enabled: !!activeBusinessId && !!customerId,
  });

  const loading = invoiceQuery.isLoading;
  const data = invoiceQuery.data;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <Appbar.Header statusBarHeight={insets.top} style={{ backgroundColor: theme.app.surface }}>
        <Appbar.BackAction onPress={() => router.back()} color={theme.app.foreground} />
        <Appbar.Content title={data ? `Invoice #${data.invoice.invoice_number}` : 'Invoice'} titleStyle={{ color: theme.app.foreground }} />
      </Appbar.Header>

      {loading ? (
        <LoadingIndicator />
      ) : invoiceQuery.error || !data ? (
        <ErrorState onRetry={() => void invoiceQuery.refetch()} />
      ) : (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xxl }]}>
          <View style={styles.amountBlock}>
            <Text style={{ fontSize: typeScale.caption, color: theme.app.mutedForeground }}>Amount due</Text>
            <Text style={{ fontSize: 32, fontWeight: '700', color: theme.app.foreground, marginTop: 2 }}>
              ${fmtMoney(data.amount_due)}
            </Text>
            <Text style={{ fontSize: typeScale.caption, color: theme.app.mutedForeground, marginTop: 2 }}>
              of ${fmtMoney(data.invoice.total)} total · due {fmtShortDate(data.invoice.due_date)}
            </Text>
          </View>

          <Card style={{ backgroundColor: theme.app.surface, marginBottom: spacing.md }}>
            <Card.Content>
              <FieldRow label="Customer" value={customerQuery.data?.name ?? '—'} theme={theme} />
              <FieldRow label="Issue date" value={fmtShortDate(data.invoice.issue_date)} theme={theme} />
              <FieldRow label="Terms" value={data.invoice.terms ?? ''} theme={theme} />
              <FieldRow label="Memo" value={data.invoice.memo ?? ''} theme={theme} last />
            </Card.Content>
          </Card>

          {parseFloat(data.amount_due) > 0 && data.invoice.status === 'posted' ? (
            <View style={{ marginBottom: spacing.lg }}>
              <Button mode="contained" disabled style={{ minHeight: minTouchTarget, justifyContent: 'center' }}>
                Pay Now
              </Button>
              <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption, textAlign: 'center', marginTop: spacing.xs }}>
                Online payments aren't set up for this firm yet — ask them to send a payment link, or pay by your usual method.
              </Text>
            </View>
          ) : null}

          <Text style={[styles.sectionTitle, { color: theme.app.foreground }]}>Lines</Text>
          <Card style={{ backgroundColor: theme.app.surface }}>
            <Card.Content>
              {data.lines.map((l, i) => (
                <View key={l.id}>
                  <View style={styles.lineRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: theme.app.foreground, fontWeight: '600' }} numberOfLines={2}>{l.description}</Text>
                      <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>
                        {l.quantity} × ${fmtMoney(l.unit_price)}
                      </Text>
                    </View>
                    <Text style={{ color: theme.app.foreground, fontWeight: '700' }}>${fmtMoney(l.line_total)}</Text>
                  </View>
                  {i < data.lines.length - 1 && <View style={[styles.divider, { backgroundColor: theme.app.border }]} />}
                </View>
              ))}
              <View style={[styles.divider, { backgroundColor: theme.app.border, marginVertical: spacing.sm }]} />
              <FieldRow label="Subtotal" value={`$${fmtMoney(data.invoice.subtotal)}`} theme={theme} />
              <FieldRow label="Tax" value={`$${fmtMoney(data.invoice.tax_total)}`} theme={theme} />
              <FieldRow label="Total" value={`$${fmtMoney(data.invoice.total)}`} theme={theme} last bold />
            </Card.Content>
          </Card>
        </ScrollView>
      )}
    </View>
  );
}

function FieldRow({ label, value, theme, last, bold }: { label: string; value: string; theme: AppTheme; last?: boolean; bold?: boolean }) {
  if (!value) return null;
  return (
    <View style={[styles.fieldRow, last && { marginBottom: 0 }]}>
      <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>{label}</Text>
      <Text style={{ color: theme.app.foreground, fontWeight: bold ? '700' : '500', marginTop: 1 }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md },
  amountBlock: { alignItems: 'center', marginBottom: spacing.lg, marginTop: spacing.sm },
  sectionTitle: { fontSize: typeScale.h2, fontWeight: '700', marginBottom: spacing.sm },
  fieldRow: { marginBottom: spacing.sm },
  lineRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm },
  divider: { height: StyleSheet.hairlineWidth },
});
