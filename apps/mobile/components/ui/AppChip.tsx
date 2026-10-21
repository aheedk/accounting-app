import { Pressable, View, Text, StyleSheet } from 'react-native';
import { useTheme } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { fontFamily, typeScale, type AppTheme } from '../../theme';

/**
 * A thin wrapper matching web's filter-pill treatment (TransactionsPage.tsx /
 * TopBar.tsx) — fully rounded (not Paper's rounded-rect Chip), bg-muted with
 * a border, a trailing chevron/close icon instead of Paper's Chip affordance.
 */
export function AppChip({
  label, onPress, active, icon, style,
}: {
  label: string;
  onPress?: () => void;
  active?: boolean;
  /** Omit for a plain toggle chip (filter pills); pass e.g. "chevron-down" for a dropdown trigger. */
  icon?: keyof typeof MaterialCommunityIcons.glyphMap;
  style?: object;
}) {
  const theme = useTheme<AppTheme>();
  const c = theme.app;

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [
      styles.base,
      {
        backgroundColor: active ? c.accent : c.surface,
        borderColor: active ? c.primary : c.border,
        opacity: pressed ? 0.8 : 1,
      },
      style,
    ]}>
      <Text
        style={{ color: active ? c.primary : c.foreground, fontFamily: fontFamily.medium, fontSize: typeScale.caption }}
        numberOfLines={1}
      >
        {label}
      </Text>
      {icon ? <MaterialCommunityIcons name={icon} size={14} color={active ? c.primary : c.mutedForeground} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6,
    alignSelf: 'flex-start',
  },
});
