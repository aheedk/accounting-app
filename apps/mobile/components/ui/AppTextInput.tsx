import { useState, type ReactNode } from 'react';
import { TextInput as RNTextInput, View, Text, StyleSheet, type TextInputProps, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from 'react-native-paper';
import { radius, fontFamily, typeScale, spacing, type AppTheme } from '../../theme';

/**
 * A thin wrapper around RN's own TextInput matching apps/web/src/components/
 * ui/input.tsx exactly — 36px height, 6px radius, our border color, a focus
 * ring instead of Paper's Material underline/filled-box look. `label` sits
 * above the field as plain text (web's <Label> pattern) rather than Paper's
 * floating label; `left`/`right` take a plain node (e.g. a "$" affix or a
 * tappable icon) instead of Paper's `<TextInput.Affix>`/`<TextInput.Icon>`.
 * `containerStyle` is for outer layout (margin, flex) — `style` still means
 * what it means on RN's own TextInput (affects the text field itself).
 * `wrapperStyle` overrides the bordered-field look itself (background,
 * border, radius, height) for the rare case that needs a different field
 * treatment entirely (e.g. a muted borderless search pill) rather than
 * this app's standard input look.
 */
export function AppTextInput({
  label, error, style, containerStyle, wrapperStyle, onFocus, onBlur, left, right, ...rest
}: TextInputProps & { label?: string; error?: string; left?: ReactNode; right?: ReactNode; containerStyle?: StyleProp<ViewStyle>; wrapperStyle?: StyleProp<ViewStyle> }) {
  const theme = useTheme<AppTheme>();
  const c = theme.app;
  const [focused, setFocused] = useState(false);

  return (
    <View style={containerStyle}>
      {label ? (
        <Text style={{ color: c.foreground, fontFamily: fontFamily.medium, fontSize: typeScale.label, marginBottom: 4 }}>
          {label}
        </Text>
      ) : null}
      <View
        style={[
          styles.wrapper,
          {
            borderColor: error ? c.destructive : focused ? c.ring : c.input,
            borderWidth: focused ? 2 : 1,
            backgroundColor: c.surface,
          },
          wrapperStyle,
        ]}
      >
        {left ? <View style={styles.affix}>{left}</View> : null}
        <RNTextInput
          placeholderTextColor={c.mutedForeground}
          onFocus={e => { setFocused(true); onFocus?.(e); }}
          onBlur={e => { setFocused(false); onBlur?.(e); }}
          style={[styles.input, { color: c.foreground }, style]}
          {...rest}
        />
        {right ? <View style={styles.affix}>{right}</View> : null}
      </View>
      {error ? (
        <Text style={{ color: c.destructive, fontSize: typeScale.caption, fontFamily: fontFamily.regular, marginTop: 4 }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flexDirection: 'row', alignItems: 'center', borderRadius: radius, paddingHorizontal: spacing.sm, minHeight: 40,
  },
  input: { flex: 1, fontFamily: fontFamily.regular, fontSize: typeScale.body, paddingVertical: 8 },
  affix: { marginHorizontal: 2 },
});
