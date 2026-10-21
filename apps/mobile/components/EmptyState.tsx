import { View, StyleSheet } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { AppTheme } from '../theme';
import { spacing } from '../theme';

/** Icon + message for an empty list — the shared shape item 8 asks every screen use, instead of a bare line of text. */
export function EmptyState({
  icon, message, compact = false,
}: { icon: keyof typeof MaterialCommunityIcons.glyphMap; message: string; compact?: boolean }) {
  const theme = useTheme<AppTheme>();
  return (
    <View style={[styles.container, compact && styles.containerCompact]}>
      <MaterialCommunityIcons name={icon} size={compact ? 20 : 32} color={theme.app.mutedForeground} />
      <Text style={{ color: theme.app.mutedForeground, textAlign: 'center', marginTop: compact ? spacing.xs : spacing.sm }}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xxl, paddingHorizontal: spacing.lg },
  containerCompact: { paddingVertical: spacing.md },
});
