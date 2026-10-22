import { View, StyleSheet, Alert, Pressable } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { hasMinRole, type Role } from '@accounting/shared';
import { useAuth } from '../hooks/useAuth';
import { AppHeader } from '../components/AppHeader';
import { StatusBadge } from '../components/ui/StatusBadge';
import { listCostCenters, deleteCostCenter, type CostCenter } from '../services/api';
import { pickErr } from '../services/apiClient';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import { spacing, typeScale, fontFamily, minTouchTarget, type AppTheme } from '../theme';

/** A free-form tag/dimension (name + optional code), no hierarchy. List +
 * delete only — create/edit aren't built this chunk. */
export default function CostCentersScreen() {
  const theme = useTheme<AppTheme>();
  const { activeBusinessId, businesses, user } = useAuth();
  const queryClient = useQueryClient();

  const effectiveRole = (businesses.find(b => b.id === activeBusinessId)?.role_override ?? user?.role ?? 'viewer') as Role;
  const canDelete = hasMinRole(effectiveRole, 'accountant');

  const query = useQuery({
    queryKey: ['cost-centers', activeBusinessId],
    queryFn: () => listCostCenters(activeBusinessId!, { include_inactive: true }),
    enabled: !!activeBusinessId,
  });

  function handleDelete(cc: CostCenter) {
    Alert.alert('Delete this cost center?', `"${cc.name}" will be removed.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await deleteCostCenter(activeBusinessId!, cc.id);
              await queryClient.invalidateQueries({ queryKey: ['cost-centers'] });
            } catch (e) {
              Alert.alert('Could not delete', pickErr(e));
            }
          })();
        },
      },
    ]);
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title="Cost Centers" />

      {query.isLoading ? (
        <LoadingIndicator />
      ) : query.error ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : (
        <FlashList
          data={query.data ?? []}
          keyExtractor={c => c.id}
          contentContainerStyle={{ paddingBottom: spacing.xxl }}
          ItemSeparatorComponent={() => <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.app.border }} />}
          ListEmptyComponent={<EmptyState icon="tag-outline" message="No cost centers yet." />}
          renderItem={({ item }: { item: CostCenter }) => (
            <View style={[styles.row, { minHeight: minTouchTarget + 10 }]}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.medium, fontSize: typeScale.body }} numberOfLines={1}>
                  {item.name}
                </Text>
                {item.code ? <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>{item.code}</Text> : null}
              </View>
              <StatusBadge status={item.is_active ? 'green' : 'gray'} label={item.is_active ? 'Active' : 'Inactive'} />
              {canDelete ? (
                <Pressable onPress={() => handleDelete(item)} hitSlop={8} style={{ marginLeft: spacing.sm }}>
                  <MaterialCommunityIcons name="trash-can-outline" size={18} color={theme.app.destructive} />
                </Pressable>
              ) : null}
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
