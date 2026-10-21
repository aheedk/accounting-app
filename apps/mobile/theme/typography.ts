/**
 * Font families loaded via expo-font (@expo-google-fonts/inter,
 * @expo-google-fonts/fraunces) in app/_layout.tsx's useFonts call — these
 * string keys are exactly what useFonts registers them under, so they're
 * usable directly as a style's fontFamily once loaded.
 *
 * Matches web's apps/web/src/index.css: body text is Inter, h1 page titles
 * keep the editorial Fraunces serif (apps/web's own comment: "reverted per
 * feedback, everything else stays Inter").
 */
export const fontFamily = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  display: 'Fraunces_600SemiBold',
} as const;

/** Same pixel sizes as web's index.css h1/h2/h3 + the body/label/caption
 * scale from the brief — no longer rescaled for the phone viewport, per
 * explicit instruction to match the web exactly. */
export const typeScale = {
  h1: 24, // Fraunces, page titles
  h2: 18,
  h3: 15,
  body: 14,
  label: 12,
  caption: 11,
} as const;
