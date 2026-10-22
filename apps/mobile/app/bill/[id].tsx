import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useAuth } from '../../hooks/useAuth';
import { AppHeader } from '../../components/AppHeader';
import { AppCard } from '../../components/ui/AppCard';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { getBill, getVendor } from '../../services/api';
import { LoadingIndicator } from '../../components/LoadingIndicator';
import { ErrorState } from '../../components/ErrorState';
import { fmtMoney, fmtShortDate } from '../../lib/money';
import { spacing, typeScale, fontFamily, type AppTheme } from '../../theme';

const BADGE = { posted: 'blue', paid: 'green', draft: 'gray', voided: 'red' } as const;

export default function BillDetailScreen() {
  const theme = useTheme<AppTheme>();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { activeBusinessId } = useAuth();

  const billQuery = useQuery({
    queryKey: ['bill', activeBusinessId, id],
    queryFn: () => getBill(activeBusinessId!, id!),
    enabled: !!activeBusinessId && !!id,
  });
  const vendorId = billQuery.data?.bill.vendor_id;
  const vendorQuery = useQuery({
    queryKey: ['vendor', activeBusinessId, vendorId],
    queryFn: () => getVendor(activeBusinessId!, vendorId!),
    enabled: !!activeBusinessId && !!vendorId,
  });

  if (billQuery.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <AppHeader title="Bill" leading="back" />
        <LoadingIndicator />
      </View>
    );
  }
  if (billQuery.error || !billQuery.data) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <AppHeader title="Bill" leading="back" />
        <ErrorState onRetry={() => void billQuery.refetch()} />
      </View>
    );
  }

  const data = billQuery.data;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title={data.bill.bill_number ? `Bill #${data.bill.bill_number}` : 'Bill'} leading="back" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.amountBlock}>
          <Text style={{ fontSize: typeScale.caption, color: theme.app.mutedForeground }}>Amount due</Text>
          <Text style={{ fontSize: 32, fontFamily: fontFamily.bold, color: theme.app.foreground, marginTop: 2 }}>
            ${fmtMoney(data.amount_due)}
          </Text>
          <Text style={{ fontSize: typeScale.caption, color: theme.app.mutedForeground, marginTop: 2 }}>
            of ${fmtMoney(data.bill.total)} total · due {fmtShortDate(data.bill.due_date)}
          </Text>
          <View style={{ marginTop: 6 }}>
            <StatusBadge status={BADGE[data.bill.status]} label={data.bill.status} />
          </View>
        </View>

        <AppCard style={{ marginBottom: spacing.md }}>
          <FieldRow label="Vendor" value={vendorQuery.data?.name ?? '—'} theme={theme} />
          <FieldRow label="Bill date" value={fmtShortDate(data.bill.bill_date)} theme={theme} />
          <FieldRow label="Terms" value={data.bill.terms ?? ''} theme={theme} />
          <FieldRow label="Memo" value={data.bill.memo ?? ''} theme={theme} last />
        </AppCard>

        <Text style={[styles.sectionTitle, { color: theme.app.foreground }]}>Lines</Text>
        <AppCard>
          {data.lines.map((l, i) => (
            <View
              key={l.id}
              style={[styles.lineRow, i < data.lines.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.app.border }]}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.semibold }} numberOfLines={2}>{l.description}</Text>
                <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>
                  {l.quantity} × ${fmtMoney(l.unit_price)}
                </Text>
              </View>
              <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.bold }}>${fmtMoney(l.line_subtotal)}</Text>
            </View>
          ))}
          <View style={[styles.lineRow, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.app.border }]}>
            <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.bold }}>Total</Text>
            <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.bold }}>${fmtMoney(data.bill.total)}</Text>
          </View>
        </AppCard>
      </ScrollView>
    </View>
  );
}

function FieldRow({ label, value, theme, last }: { label: string; value: string; theme: AppTheme; last?: boolean }) {
  if (!value) return null;
  return (
    <View style={[styles.fieldRow, last && { marginBottom: 0 }]}>
      <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>{label}</Text>
      <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.medium, marginTop: 1 }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, paddingBottom: spacing.xxl },
  amountBlock: { alignItems: 'flex-start', marginBottom: spacing.md },
  sectionTitle: { fontSize: typeScale.h3, fontFamily: fontFamily.semibold, marginBottom: spacing.sm, marginTop: spacing.sm },
  fieldRow: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginBottom: spacing.xs },
  lineRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
});
