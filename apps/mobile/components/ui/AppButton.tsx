import { Pressable, StyleSheet, View } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { LoadingIndicator } from '../LoadingIndicator';
import { minTouchTarget, radius, fontFamily, typeScale, type AppTheme } from '../../theme';

export type ButtonVariant = 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';

/**
 * A thin wrapper around Pressable matching apps/web/src/components/ui/
 * button.tsx exactly — 6px radius (not Paper's pill-shaped contained
 * button), the same variant palette and font weights, instead of styling
 * Paper's <Button> to try to look like this.
 */
export function AppButton({
  children, onPress, variant = 'default', disabled, loading, style, fullWidth,
}: {
  children: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  style?: object;
}) {
  const theme = useTheme<AppTheme>();
  const c = theme.app;
  const isDisabled = disabled || loading;

  const variantStyle: Record<ButtonVariant, { bg: string; fg: string; border?: string; weight: '500' | '600' }> = {
    default: { bg: c.primary, fg: c.primaryForeground, weight: '600' },
    destructive: { bg: c.destructive, fg: c.destructiveForeground, weight: '600' },
    outline: { bg: c.surface, fg: c.secondaryForeground, border: c.input, weight: '500' },
    secondary: { bg: c.secondary, fg: c.secondaryForeground, border: c.input, weight: '500' },
    ghost: { bg: 'transparent', fg: c.secondaryForeground, weight: '500' },
    link: { bg: 'transparent', fg: c.link, weight: '500' },
  };
  const v = variantStyle[variant];

  return (
    <Pressable
      onPress={isDisabled ? undefined : onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        fullWidth && styles.fullWidth,
        {
          backgroundColor: v.bg,
          borderColor: v.border,
          borderWidth: v.border ? 1 : 0,
          opacity: isDisabled ? 0.5 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <LoadingIndicator size="sm" />
      ) : variant === 'link' ? (
        <Text style={{ color: v.fg, fontFamily: fontFamily.medium, fontSize: typeScale.body, textDecorationLine: 'underline' }}>
          {children}
        </Text>
      ) : (
        <View style={styles.row}>
          <Text style={{ color: v.fg, fontFamily: v.weight === '600' ? fontFamily.semibold : fontFamily.medium, fontSize: typeScale.body }}>
            {children}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: minTouchTarget, borderRadius: radius, paddingHorizontal: 16,
    alignItems: 'center', justifyContent: 'center',
  },
  fullWidth: { width: '100%' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
