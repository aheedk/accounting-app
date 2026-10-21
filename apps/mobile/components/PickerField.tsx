import { Pressable, StyleSheet, View } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { spacing, typeScale, minTouchTarget, type AppTheme } from '../theme';

/** A tappable field styled like a TextInput, opening a SearchablePicker on press. */
export function PickerField({
  label, value, placeholder = 'Select…', onPress, error,
}: {
  label: string;
  value: string | null;
  placeholder?: string;
  onPress: () => void;
  error?: string;
}) {
  const theme = useTheme<AppTheme>();
  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={{ fontSize: typeScale.caption, color: theme.app.mutedForeground, marginBottom: 4 }}>{label}</Text>
      <Pressable
        onPress={onPress}
        style={[
          styles.field,
          { minHeight: minTouchTarget, borderColor: error ? theme.app.destructive : theme.app.border, backgroundColor: theme.app.surface },
        ]}
      >
        <Text style={{ color: value ? theme.app.foreground : theme.app.mutedForeground, flex: 1 }} numberOfLines={1}>
          {value ?? placeholder}
        </Text>
        <MaterialCommunityIcons name="chevron-down" size={20} color={theme.app.mutedForeground} />
      </Pressable>
      {error ? <Text style={{ color: theme.app.destructive, fontSize: typeScale.caption, marginTop: 4 }}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 8,
    paddingHorizontal: spacing.sm,
  },
});
