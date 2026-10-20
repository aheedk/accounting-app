import { MD3LightTheme, MD3DarkTheme, type MD3Theme } from 'react-native-paper';
import { lightColors, darkColors, type AppColors } from './colors';

export { spacing, minTouchTarget, typeScale } from './spacing';
export { lightColors, darkColors };
export type { AppColors };

// No fontConfig override here on purpose: Paper's MD3 default font config
// already resolves to the platform's own system font (San Francisco on iOS,
// Roboto on Android) when nothing is loaded via expo-font — exactly what
// "native, not Inter" means. Loading a custom font would be the one thing
// that breaks that.
function buildTheme(base: MD3Theme, c: AppColors): MD3Theme & { app: AppColors } {
  return {
    ...base,
    roundness: 10,
    colors: {
      ...base.colors,
      primary: c.primary,
      onPrimary: c.primaryForeground,
      background: c.page,
      surface: c.surface,
      onSurface: c.foreground,
      onSurfaceVariant: c.mutedForeground,
      outline: c.border,
      outlineVariant: c.border,
      error: c.destructive,
      onError: c.destructiveForeground,
      surfaceVariant: c.page,
      elevation: {
        ...base.colors.elevation,
        level0: 'transparent',
        level1: c.surface,
        level2: c.surface,
        level3: c.surface,
        level4: c.surface,
        level5: c.surface,
      },
    },
    // Not part of MD3Theme — our own brand colors (status badges, the sidebar
    // navy, gold) that Paper's generic palette has no slot for. Screens read
    // theme.app.* alongside the standard theme.colors.*.
    app: c,
  };
}

export const appLightTheme = buildTheme(MD3LightTheme, lightColors);
export const appDarkTheme = buildTheme(MD3DarkTheme, darkColors);
export type AppTheme = typeof appLightTheme;
