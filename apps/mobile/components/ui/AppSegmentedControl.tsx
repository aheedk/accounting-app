import { Pressable, View, Text, StyleSheet } from 'react-native';
import { useTheme } from 'react-native-paper';
import { radius, fontFamily, typeScale, type AppTheme } from '../../theme';

/**
 * A thin wrapper matching web's tab-switcher treatment
 * (BankTransactionsInboxPage.tsx: a bg-muted track with an active segment
 * that lifts to the surface color) — not Paper's outlined SegmentedButtons.
 */
export function AppSegmentedControl<T extends string>({
  value, onChange, options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  const theme = useTheme<AppTheme>();
  const c = theme.app;

  return (
    <View style={[styles.track, { backgroundColor: c.muted }]}>
      {options.map(opt => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            style={[styles.segment, active && { backgroundColor: c.surface, borderColor: c.border, borderWidth: 1 }]}
          >
            <Text style={{ color: active ? c.foreground : c.mutedForeground, fontFamily: fontFamily.medium, fontSize: typeScale.caption }}>
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', borderRadius: radius, padding: 3, gap: 3 },
  segment: { flex: 1, borderRadius: radius - 1, paddingVertical: 7, alignItems: 'center' },
});
