import { View, StyleSheet } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { AppTheme } from '../../theme';
import { spacing, typeScale } from '../../theme';

/** Stub for this first chunk — the quick-create menu (new expense/deposit/
 * check/invoice/JE) is Phase 1, item 5, built after the dashboard and
 * transaction list are reviewed. */
export default function CreateScreen() {
  const theme = useTheme<AppTheme>();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background, paddingTop: insets.top }]}>
      <MaterialCommunityIcons name="plus-circle-outline" size={40} color={theme.app.mutedForeground} />
      <Text style={{ fontSize: typeScale.h2, fontWeight: '700', color: theme.app.foreground, marginTop: spacing.md }}>
        Quick create
      </Text>
      <Text style={{ color: theme.app.mutedForeground, textAlign: 'center', marginTop: spacing.xs, maxWidth: 260 }}>
        New expense, deposit, check, invoice and journal entry land here next.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
});
