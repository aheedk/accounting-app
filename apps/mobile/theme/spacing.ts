/** 8px grid, same as the web app — but every tappable control stays at least
 * 44px tall (Apple's Human Interface Guidelines minimum touch target),
 * which the 8px scale alone doesn't guarantee. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const minTouchTarget = 44;

/** Web-exact type scale now lives in theme/typography.ts (24/18/15/14/12/11,
 * same pixel sizes as web — no longer rescaled for the phone viewport). */
export { typeScale, fontFamily } from './typography';

/** Web's border radius (rounded-md = 6px) — used directly by component
 * primitives rather than Paper's roundness multiplier, for exact control. */
export const radius = 6;
