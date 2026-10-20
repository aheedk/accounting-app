import { View, StyleSheet, FlatList } from 'react-native';
import { Text, List, useTheme } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../hooks/useAuth';
import type { AppTheme } from '../../theme';
import { spacing, typeScale } from '../../theme';

/**
 * The business switcher (Phase 1, item 2) is real — it's the same data
 * useAuth already loaded at login (apps/api's GET /me). Vendor and customer
 * lists (also named for this tab) are a stub for now, same reason as
 * create.tsx: scoped out of this first chunk.
 */
export default function ClientsScreen() {
  const theme = useTheme<AppTheme>();
  const insets = useSafeAreaInsets();
  const { businesses, activeBusinessId, setActiveBusinessId } = useAuth();

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background, paddingTop: insets.top }}>
      <View style={styles.header}>
        <Text style={{ fontSize: typeScale.h1, fontWeight: '700', color: theme.app.foreground }}>Clients</Text>
        <Text style={{ color: theme.app.mutedForeground, marginTop: 2 }}>Tap a business to switch to it</Text>
      </View>

      <FlatList
        data={businesses}
        keyExtractor={b => b.id}
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
        renderItem={({ item }) => {
          const active = item.id === activeBusinessId;
          return (
            <List.Item
              title={item.name}
              description={item.role_override ?? undefined}
              onPress={() => setActiveBusinessId(item.id)}
              style={{ backgroundColor: active ? theme.app.statusBlueBg : 'transparent' }}
              left={props => <List.Icon {...props} icon="domain" color={active ? theme.app.primary : theme.app.mutedForeground} />}
              right={active ? props => <List.Icon {...props} icon="check" color={theme.app.primary} /> : undefined}
              titleStyle={{ color: theme.app.foreground, fontWeight: active ? '700' : '500' }}
            />
          );
        }}
      />

      <View style={[styles.comingSoon, { borderTopColor: theme.app.border }]}>
        <MaterialCommunityIcons name="account-group-outline" size={24} color={theme.app.mutedForeground} />
        <Text style={{ color: theme.app.mutedForeground, marginTop: spacing.xs, textAlign: 'center' }}>
          Vendor and customer lists land here next.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { padding: spacing.md, paddingBottom: spacing.sm },
  comingSoon: { padding: spacing.lg, alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth },
});
