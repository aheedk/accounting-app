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

/** Same relative ratios as the web app's h1/h2/h3/body/caption (24/18/15/14/12),
 * just resized for a phone screen where 24px reads as oversized relative to
 * the viewport. Ratios preserved: h1:body = 1.71, h2:body = 1.29, h3:body = 1.07. */
export const typeScale = {
  h1: 22,
  h2: 17,
  h3: 14,
  body: 13,
  caption: 11,
} as const;
