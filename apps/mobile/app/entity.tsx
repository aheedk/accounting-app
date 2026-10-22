import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../hooks/useAuth';
import { AppHeader } from '../components/AppHeader';
import { AppCard } from '../components/ui/AppCard';
import { getBusinessSettings } from '../services/api';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { ErrorState } from '../components/ErrorState';
import { spacing, typeScale, fontFamily, type AppTheme } from '../theme';

/** Read-only: edit is firm_admin-only and shares the same GET/PATCH
 * endpoint as Company Settings — not built this chunk, same low-
 * frequency-setup-action scoping as Bank Accounts. */
export default function EntityScreen() {
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
        <AppHeader title="Entity" />
        <LoadingIndicator />
      </View>
    );
  }
  if (query.error || !query.data) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <AppHeader title="Entity" />
        <ErrorState onRetry={() => void query.refetch()} />
      </View>
    );
  }

  const b = query.data;
  const addressLines = b.address
    ? [b.address.line1, b.address.line2, [b.address.city, b.address.state, b.address.postal_code].filter(Boolean).join(', '), b.address.country]
      .filter(Boolean).join('\n')
    : '';

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title="Entity" />
      <ScrollView contentContainerStyle={styles.content}>
        <AppCard>
          <FieldRow label="Business name" value={b.name} theme={theme} />
          <FieldRow label="Legal name" value={b.legal_name ?? '—'} theme={theme} />
          <FieldRow label="Tax ID" value={b.tax_id ?? '—'} theme={theme} />
          <FieldRow label="Phone" value={b.phone ?? '—'} theme={theme} />
          <FieldRow label="Import email" value={b.import_email ?? '—'} theme={theme} />
          <FieldRow label="Address" value={addressLines || '—'} theme={theme} last />
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
});
