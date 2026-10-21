import { MD3LightTheme, MD3DarkTheme, configureFonts, type MD3Theme } from 'react-native-paper';
import { lightColors, darkColors, type AppColors } from './colors';
import { fontFamily } from './typography';

export { spacing, minTouchTarget, typeScale, radius } from './spacing';
export { lightColors, darkColors };
export { fontFamily } from './typography';
export type { AppColors };

// Paper's MD3 default fonts fall back to Roboto/system — explicitly pointed
// at the loaded Inter weights instead (app/_layout.tsx's useFonts), so every
// Paper-native component (Button labels, AppBar title, List.Item, Chip...)
// renders Inter, matching web, instead of the platform system font.
const fontConfig = {
  fontFamily: fontFamily.regular,
};
const headingFontConfig = { fontFamily: fontFamily.semibold };
const labelFontConfig = { fontFamily: fontFamily.medium };

const fonts = configureFonts({
  config: {
    ...Object.fromEntries(
      ['displayLarge', 'displayMedium', 'displaySmall', 'headlineLarge', 'headlineMedium', 'headlineSmall', 'titleLarge', 'titleMedium', 'titleSmall']
        .map(variant => [variant, headingFontConfig]),
    ),
    ...Object.fromEntries(
      ['labelLarge', 'labelMedium', 'labelSmall'].map(variant => [variant, labelFontConfig]),
    ),
    ...Object.fromEntries(
      ['bodyLarge', 'bodyMedium', 'bodySmall'].map(variant => [variant, fontConfig]),
    ),
  },
}) as MD3Theme['fonts'];

// Every MD3 color role mapped to our own tokens — Paper falls back to its
// stock Material purple/teal palette (secondary, tertiary, the *Container
// roles) for anything left unmapped, which is why unstyled Paper components
// (Chip, SegmentedButtons, Switch, FAB) were reading as "generic Material
// Design app" instead of our brand. The brand only has one accent hue
// (blue), so tertiary intentionally mirrors primary rather than inventing a
// third color Paper's scheme assumes exists.
function buildTheme(base: MD3Theme, c: AppColors): MD3Theme & { app: AppColors } {
  return {
    ...base,
    roundness: 1, // component primitives use theme.app's own `radius` (6px) directly instead
    fonts,
    colors: {
      ...base.colors,
      primary: c.primary,
      onPrimary: c.primaryForeground,
      primaryContainer: c.statusBlueBg,
      onPrimaryContainer: c.statusBlueFg,
      secondary: c.secondary,
      onSecondary: c.secondaryForeground,
      secondaryContainer: c.muted,
      onSecondaryContainer: c.foreground,
      tertiary: c.primary,
      onTertiary: c.primaryForeground,
      tertiaryContainer: c.accent,
      onTertiaryContainer: c.foreground,
      background: c.page,
      onBackground: c.foreground,
      surface: c.surface,
      onSurface: c.foreground,
      surfaceVariant: c.page,
      onSurfaceVariant: c.mutedForeground,
      outline: c.border,
      outlineVariant: c.border,
      error: c.destructive,
      onError: c.destructiveForeground,
      errorContainer: c.statusRedBg,
      onErrorContainer: c.statusRedFg,
      inversePrimary: c.primary,
      inverseSurface: c.foreground,
      inverseOnSurface: c.background,
      backdrop: 'rgba(16,20,31,0.5)',
      scrim: 'rgba(16,20,31,0.5)',
      surfaceDisabled: c.border,
      onSurfaceDisabled: c.mutedForeground,
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
