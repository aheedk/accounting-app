import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { spacing, typeScale, minTouchTarget, type AppTheme } from '../theme';
import { fmtShortDate } from '../lib/money';

/**
 * The native date picker the batch spec asked for explicitly (not a text
 * input): iOS renders its own compact button that pops the system calendar
 * on tap; Android has no inline widget, so the same tap opens the system
 * dialog imperatively via DateTimePickerAndroid.
 */
export function DateField({ label, value, onChange }: { label: string; value: string; onChange: (iso: string) => void }) {
  const theme = useTheme<AppTheme>();
  const dateObj = new Date(`${value}T00:00:00`);

  function toIso(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  if (Platform.OS === 'android') {
    return (
      <View style={{ marginBottom: spacing.md }}>
        <Text style={{ fontSize: typeScale.caption, color: theme.app.mutedForeground, marginBottom: 4 }}>{label}</Text>
        <Pressable
          onPress={() => DateTimePickerAndroid.open({
            value: dateObj, mode: 'date',
            onChange: (_e, selected) => { if (selected) onChange(toIso(selected)); },
          })}
          style={[styles.field, { minHeight: minTouchTarget, borderColor: theme.app.border, backgroundColor: theme.app.surface }]}
        >
          <Text style={{ color: theme.app.foreground, flex: 1 }}>{fmtShortDate(value)}</Text>
          <MaterialCommunityIcons name="calendar" size={20} color={theme.app.mutedForeground} />
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={{ fontSize: typeScale.caption, color: theme.app.mutedForeground, marginBottom: 4 }}>{label}</Text>
      <View style={[styles.iosField, { borderColor: theme.app.border, backgroundColor: theme.app.surface }]}>
        <DateTimePicker
          value={dateObj}
          mode="date"
          display="compact"
          onChange={(_e, selected) => { if (selected) onChange(toIso(selected)); }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 8,
    paddingHorizontal: spacing.sm,
  },
  iosField: {
    flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 8,
    paddingHorizontal: spacing.sm, paddingVertical: 4, alignSelf: 'flex-start',
  },
});
