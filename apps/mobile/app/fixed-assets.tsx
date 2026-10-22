import { View, StyleSheet, Pressable } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { FlashList } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../hooks/useAuth';
import { AppHeader } from '../components/AppHeader';
import { AppCard } from '../components/ui/AppCard';
import { StatusBadge } from '../components/ui/StatusBadge';
import { listFixedAssets, type FixedAssetRow } from '../services/api';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import { fmtMoney, fmtShortDate } from '../lib/money';
import { spacing, typeScale, fontFamily, minTouchTarget, type AppTheme } from '../theme';

/** Read-only: create/edit/depreciate exist server-side but aren't built
 * here — same reference-screen scoping as Chart of Accounts. */
export default function FixedAssetsScreen() {
  const theme = useTheme<AppTheme>();
  const insets = useSafeAreaInsets();
  const { activeBusinessId } = useAuth();

  const query = useQuery({
    queryKey: ['fixed-assets', activeBusinessId],
    queryFn: () => listFixedAssets(activeBusinessId!),
    enabled: !!activeBusinessId,
  });

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title="Fixed Assets" />

      {query.isLoading ? (
        <LoadingIndicator />
      ) : query.error || !query.data ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : (
        <>
          <AppCard style={{ margin: spacing.md, padding: spacing.md }}>
            <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>Total asset cost (ledger)</Text>
            <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.bold, fontSize: typeScale.h2 }}>
              ${fmtMoney(query.data.ledger_cost_total)}
            </Text>
          </AppCard>
          <FlashList
            data={query.data.fixed_assets}
            keyExtractor={a => a.id}
            contentContainerStyle={{ paddingHorizontal: spacing.md, paddingBottom: insets.bottom + spacing.xxl }}
            ItemSeparatorComponent={() => <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.app.border }} />}
            ListEmptyComponent={<EmptyState icon="office-building-outline" message="No fixed assets yet." />}
            renderItem={({ item }: { item: FixedAssetRow }) => <AssetRow asset={item} theme={theme} />}
          />
        </>
      )}
    </View>
  );
}

function AssetRow({ asset, theme }: { asset: FixedAssetRow; theme: AppTheme }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.row, { minHeight: minTouchTarget + 10, opacity: pressed ? 0.6 : 1 }]}
      onPress={() => router.push({ pathname: '/fixed-asset/[id]', params: { id: asset.id } })}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.semibold, fontSize: typeScale.body }} numberOfLines={1}>
          {asset.name}
        </Text>
        <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>
          Purchased {fmtShortDate(asset.purchase_date)}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 2 }}>
        <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.semibold }}>${fmtMoney(asset.book_value)}</Text>
        <StatusBadge status={asset.status === 'active' ? 'green' : 'gray'} label={asset.status} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm },
});
