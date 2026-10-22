import { View, StyleSheet, Pressable } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { FlashList } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../hooks/useAuth';
import { AppHeader } from '../components/AppHeader';
import { listContractors, type Contractor } from '../services/api';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import { spacing, typeScale, fontFamily, minTouchTarget, type AppTheme } from '../theme';

function maskedTaxId(c: Contractor): string | null {
  if (!c.tax_id_last_four) return null;
  return c.tax_id_type === 'EIN' ? `**-***${c.tax_id_last_four}` : `***-**-${c.tax_id_last_four}`;
}

/** Vendors with is_1099=true — same underlying data as the Vendors list, via
 * the dedicated /contractors route, which adds the masked tax ID fields the
 * plain vendor list doesn't carry. Read-only: web's tax-id reveal and W-9
 * edit are firm_admin-only, low-frequency actions not built this chunk. */
export default function ContractorsScreen() {
  const theme = useTheme<AppTheme>();
  const insets = useSafeAreaInsets();
  const { activeBusinessId } = useAuth();

  const query = useQuery({
    queryKey: ['contractors', activeBusinessId],
    queryFn: () => listContractors(activeBusinessId!),
    enabled: !!activeBusinessId,
  });

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title="Contractors" />

      {query.isLoading ? (
        <LoadingIndicator />
      ) : query.error ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : (
        <FlashList
          data={query.data ?? []}
          keyExtractor={c => c.id}
          contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
          ItemSeparatorComponent={() => <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.app.border }} />}
          ListEmptyComponent={<EmptyState icon="account-hard-hat-outline" message="No 1099 contractors yet." />}
          renderItem={({ item }: { item: Contractor }) => (
            <Pressable
              style={({ pressed }) => [styles.row, { minHeight: minTouchTarget + 10, opacity: pressed ? 0.6 : 1 }]}
              onPress={() => router.push({ pathname: '/vendor/[id]', params: { id: item.id } })}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.semibold, fontSize: typeScale.body }} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }} numberOfLines={1}>
                  {item.email ?? item.phone ?? '—'}
                </Text>
              </View>
              <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption, fontFamily: fontFamily.medium }}>
                {maskedTaxId(item) ?? 'No tax ID on file'}
              </Text>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
});
