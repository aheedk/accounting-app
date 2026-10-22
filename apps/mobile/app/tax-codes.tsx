import { View, StyleSheet } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { FlashList } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../hooks/useAuth';
import { AppHeader } from '../components/AppHeader';
import { StatusBadge } from '../components/ui/StatusBadge';
import { listTaxCodes, type TaxCode } from '../services/api';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import { spacing, typeScale, fontFamily, type AppTheme } from '../theme';

/** Read-only: rate history is append-only server-side (no delete), and
 * create/edit aren't built this chunk. */
export default function TaxCodesScreen() {
  const theme = useTheme<AppTheme>();
  const { activeBusinessId } = useAuth();

  const query = useQuery({
    queryKey: ['tax-codes', activeBusinessId],
    queryFn: () => listTaxCodes(activeBusinessId!),
    enabled: !!activeBusinessId,
  });

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title="Tax Codes" />

      {query.isLoading ? (
        <LoadingIndicator />
      ) : query.error ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : (
        <FlashList
          data={query.data ?? []}
          keyExtractor={t => t.id}
          contentContainerStyle={{ paddingBottom: spacing.xxl }}
          ItemSeparatorComponent={() => <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.app.border }} />}
          ListEmptyComponent={<EmptyState icon="percent-outline" message="No tax codes set up." />}
          renderItem={({ item }: { item: TaxCode }) => (
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.medium }} numberOfLines={1}>
                  {item.code} — {item.name}
                </Text>
                <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>
                  {item.current_rate ? `${item.current_rate}%` : 'No current rate'}
                </Text>
              </View>
              <StatusBadge status={item.is_active ? 'green' : 'gray'} label={item.is_active ? 'Active' : 'Inactive'} />
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
});
