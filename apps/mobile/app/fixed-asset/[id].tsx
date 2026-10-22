import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useAuth } from '../../hooks/useAuth';
import { AppHeader } from '../../components/AppHeader';
import { AppCard } from '../../components/ui/AppCard';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { getFixedAsset } from '../../services/api';
import { LoadingIndicator } from '../../components/LoadingIndicator';
import { ErrorState } from '../../components/ErrorState';
import { fmtMoney, fmtShortDate } from '../../lib/money';
import { spacing, typeScale, fontFamily, type AppTheme } from '../../theme';

export default function FixedAssetDetailScreen() {
  const theme = useTheme<AppTheme>();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { activeBusinessId } = useAuth();

  const query = useQuery({
    queryKey: ['fixed-asset', activeBusinessId, id],
    queryFn: () => getFixedAsset(activeBusinessId!, id!),
    enabled: !!activeBusinessId && !!id,
  });

  if (query.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <AppHeader title="Fixed Asset" leading="back" />
        <LoadingIndicator />
      </View>
    );
  }
  if (query.error || !query.data) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <AppHeader title="Fixed Asset" leading="back" />
        <ErrorState onRetry={() => void query.refetch()} />
      </View>
    );
  }

  const asset = query.data;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title={asset.name} leading="back" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.amountBlock}>
          <Text style={{ fontSize: typeScale.caption, color: theme.app.mutedForeground }}>Book value</Text>
          <Text style={{ fontSize: 32, fontFamily: fontFamily.bold, color: theme.app.foreground, marginTop: 2 }}>
            ${fmtMoney(asset.book_value)}
          </Text>
          <Text style={{ fontSize: typeScale.caption, color: theme.app.mutedForeground, marginTop: 2 }}>
            of ${fmtMoney(asset.cost)} cost
          </Text>
          <View style={{ marginTop: 6 }}>
            <StatusBadge status={asset.status === 'active' ? 'green' : 'gray'} label={asset.status} />
          </View>
        </View>

        <AppCard>
          <FieldRow label="Purchase date" value={fmtShortDate(asset.purchase_date)} theme={theme} />
          <FieldRow label="Cost" value={`$${fmtMoney(asset.cost)}`} theme={theme} />
          <FieldRow label="Salvage value" value={`$${fmtMoney(asset.salvage_value)}`} theme={theme} />
          <FieldRow label="Useful life" value={`${asset.useful_life_years} years`} theme={theme} />
          <FieldRow label="Depreciation method" value={asset.depreciation_method.replace('_', ' ')} theme={theme} />
          <FieldRow label="Accumulated depreciation" value={`$${fmtMoney(asset.accumulated_depreciation)}`} theme={theme} />
          {asset.memo ? <FieldRow label="Memo" value={asset.memo} theme={theme} last /> : null}
        </AppCard>
      </ScrollView>
    </View>
  );
}

function FieldRow({ label, value, theme, last }: { label: string; value: string; theme: AppTheme; last?: boolean }) {
  return (
    <View style={[styles.fieldRow, last && { marginBottom: 0 }]}>
      <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>{label}</Text>
      <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.medium, marginTop: 1, textTransform: 'capitalize' }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, paddingBottom: spacing.xxl },
  amountBlock: { alignItems: 'flex-start', marginBottom: spacing.md },
  fieldRow: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginBottom: spacing.xs },
});
