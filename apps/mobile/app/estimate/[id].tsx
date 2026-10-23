import { View, StyleSheet, ScrollView, Pressable } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, router } from 'expo-router';
import { useAuth } from '../../hooks/useAuth';
import { AppHeader } from '../../components/AppHeader';
import { AppCard } from '../../components/ui/AppCard';
import { StatusBadge, type BadgeStatus } from '../../components/ui/StatusBadge';
import { getEstimate, type EstimateStatus } from '../../services/api';
import { LoadingIndicator } from '../../components/LoadingIndicator';
import { ErrorState } from '../../components/ErrorState';
import { fmtMoney, fmtShortDate } from '../../lib/money';
import { spacing, typeScale, fontFamily, type AppTheme } from '../../theme';

const STATUS_LABELS: Record<EstimateStatus, string> = {
  pending: 'Pending', accepted: 'Accepted', rejected: 'Rejected', closed: 'Closed',
};
const STATUS_BADGES: Record<EstimateStatus, BadgeStatus> = {
  pending: 'blue', accepted: 'green', rejected: 'red', closed: 'gray',
};

export default function EstimateDetailScreen() {
  const theme = useTheme<AppTheme>();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { activeBusinessId } = useAuth();

  const query = useQuery({
    queryKey: ['estimate', activeBusinessId, id],
    queryFn: () => getEstimate(activeBusinessId!, id!),
    enabled: !!activeBusinessId && !!id,
  });

  if (query.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <AppHeader title="Estimate" leading="back" />
        <LoadingIndicator />
      </View>
    );
  }
  if (query.error || !query.data) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <AppHeader title="Estimate" leading="back" />
        <ErrorState onRetry={() => void query.refetch()} />
      </View>
    );
  }

  const { estimate, lines, invoice_number } = query.data;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title={estimate.estimate_number} leading="back" />
      <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xxl }}>
        <AppCard style={{ padding: spacing.md, marginBottom: spacing.md, gap: spacing.xs }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.semibold }}>{estimate.customer_name}</Text>
            <StatusBadge status={STATUS_BADGES[estimate.status]} label={STATUS_LABELS[estimate.status]} />
          </View>
          <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>
            {fmtShortDate(estimate.estimate_date)}{estimate.expiration_date ? ` · Expires ${fmtShortDate(estimate.expiration_date)}` : ''}
          </Text>
          {estimate.memo ? <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption, marginTop: spacing.xs }}>{estimate.memo}</Text> : null}
          {estimate.invoice_id && invoice_number ? (
            <Pressable onPress={() => router.push({ pathname: '/invoice/[id]', params: { id: estimate.invoice_id! } })} style={{ marginTop: spacing.xs }}>
              <Text style={{ color: theme.app.primary, fontFamily: fontFamily.medium }}>Converted to invoice {invoice_number} →</Text>
            </Pressable>
          ) : null}
        </AppCard>

        <AppCard style={{ padding: 0, marginBottom: spacing.md }}>
          {lines.map((line, i) => (
            <View key={line.id} style={[styles.lineRow, i !== lines.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.app.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.app.foreground }} numberOfLines={2}>{line.description}</Text>
                <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>{fmtMoney(line.quantity)} × ${fmtMoney(line.unit_price)}</Text>
              </View>
              <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.medium }}>${fmtMoney(line.line_total)}</Text>
            </View>
          ))}
          <View style={[styles.lineRow, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.app.border }]}>
            <Text style={{ color: theme.app.mutedForeground, flex: 1 }}>Subtotal</Text>
            <Text style={{ color: theme.app.foreground }}>${fmtMoney(estimate.subtotal)}</Text>
          </View>
          {parseFloat(estimate.tax_total) !== 0 ? (
            <View style={styles.lineRow}>
              <Text style={{ color: theme.app.mutedForeground, flex: 1 }}>Tax</Text>
              <Text style={{ color: theme.app.foreground }}>${fmtMoney(estimate.tax_total)}</Text>
            </View>
          ) : null}
          <View style={styles.lineRow}>
            <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.bold, flex: 1 }}>Total</Text>
            <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.bold }}>${fmtMoney(estimate.total)}</Text>
          </View>
        </AppCard>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  lineRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.sm },
});
