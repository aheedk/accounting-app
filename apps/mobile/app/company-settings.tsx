import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../hooks/useAuth';
import { AppHeader } from '../components/AppHeader';
import { AppCard } from '../components/ui/AppCard';
import { StatusBadge } from '../components/ui/StatusBadge';
import { getBusinessSettings } from '../services/api';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { ErrorState } from '../components/ErrorState';
import { fmtMoney } from '../lib/money';
import { spacing, typeScale, fontFamily, type AppTheme } from '../theme';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Read-only, same reasoning as entity.tsx — shares the same firm_admin-
 * gated PATCH endpoint, not built this chunk. */
export default function CompanySettingsScreen() {
  const theme = useTheme<AppTheme>();
  const { activeBusinessId } = useAuth();

  const query = useQuery({
    queryKey: ['business-settings', activeBusinessId],
    queryFn: () => getBusinessSettings(activeBusinessId!),
    enabled: !!activeBusinessId,
  });

  if (query.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <AppHeader title="Company Settings" />
        <LoadingIndicator />
      </View>
    );
  }
  if (query.error || !query.data) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <AppHeader title="Company Settings" />
        <ErrorState onRetry={() => void query.refetch()} />
      </View>
    );
  }

  const b = query.data;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title="Company Settings" />
      <ScrollView contentContainerStyle={styles.content}>
        <AppCard style={{ marginBottom: spacing.md }}>
          <FieldRow label="Fiscal year starts" value={MONTHS[b.fiscal_year_start_month - 1] ?? String(b.fiscal_year_start_month)} theme={theme} />
          <FieldRow label="Capitalization threshold" value={`$${fmtMoney(b.capitalization_threshold)}`} theme={theme} />
          <FieldRow label="Default expense payment method" value={b.default_expense_payment_method} theme={theme} />
          <FieldRow label="Default invoice terms" value={`${b.default_invoice_terms_days} days`} theme={theme} />
          <FieldRow label="Default bill terms" value={`${b.default_bill_terms_days} days`} theme={theme} last />
        </AppCard>

        <AppCard style={{ marginBottom: spacing.md }}>
          <FieldRow label="Invoice number prefix" value={b.invoice_number_prefix || '—'} theme={theme} />
          <FieldRow label="Next invoice number" value={b.invoice_next_number ?? '1001'} theme={theme} last />
        </AppCard>

        <AppCard>
          <View style={styles.toggleRow}>
            <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.medium, flex: 1 }}>AI auto-post</Text>
            <StatusBadge status={b.ai_auto_post_enabled ? 'green' : 'gray'} label={b.ai_auto_post_enabled ? 'On' : 'Off'} />
          </View>
          <View style={[styles.toggleRow, { marginBottom: 0 }]}>
            <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.medium, flex: 1 }}>Staff entries need approval</Text>
            <StatusBadge status={b.staff_entries_need_approval ? 'green' : 'gray'} label={b.staff_entries_need_approval ? 'On' : 'Off'} />
          </View>
        </AppCard>
      </ScrollView>
    </View>
  );
}

function FieldRow({ label, value, theme, last }: { label: string; value: string; theme: AppTheme; last?: boolean }) {
  return (
    <View style={[styles.fieldRow, last && { marginBottom: 0 }]}>
      <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>{label}</Text>
      <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.medium, marginTop: 1 }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, paddingBottom: spacing.xxl },
  fieldRow: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginBottom: spacing.xs },
  toggleRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginBottom: spacing.xs },
});
