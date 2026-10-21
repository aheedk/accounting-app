/**
 * The web app's exact brand palette (apps/web/src/index.css), converted from
 * its HSL CSS variables to hex. This is the ONE source of truth for both — if
 * the web palette changes, convert its --variables the same way and update
 * here; nothing here should drift from a separate decision.
 *
 * The web app has no dark mode today (light-only). darkColors below is this
 * app's own design, not a literal port — there was nothing to copy. It reuses
 * the web's existing navy sidebar color as the dark surface (the one color
 * this brand already treats as "dark"), brightens the blue accent and the
 * status colors enough to read on a dark ground, and otherwise keeps the same
 * relationships (same hue for primary, same red for destructive, etc).
 */

export const lightColors = {
  background: '#ffffff',
  surface: '#ffffff',
  page: '#f3f4f6',
  foreground: '#1f2937',
  mutedForeground: '#6b7280',
  border: '#e1e3e5',
  input: '#d1d5db',
  // --muted / --accent are the same light-gray surface on web (table
  // headers, hover states); --secondary is a plain white pill with the
  // same foreground as muted text.
  muted: '#f3f4f6',
  accent: '#f3f4f6',
  accentForeground: '#384252',
  secondary: '#ffffff',
  secondaryForeground: '#384252',

  primary: '#2755b9',
  primaryHover: '#204697',
  primaryForeground: '#ffffff',

  link: '#0077c7',
  ring: '#0077c7',

  destructive: '#d13d3d',
  destructiveForeground: '#ffffff',

  statusGreenBg: '#e6f4ea',
  statusGreenFg: '#1e8035',
  statusRedBg: '#fdeae8',
  statusRedFg: '#d13d3d',
  statusBlueBg: '#e7effe',
  statusBlueFg: '#1c74e9',
  statusGrayBg: '#f1f3f4',
  statusGrayFg: '#5e6368',

  sidebar: '#151d33',
  sidebarForeground: '#e4e9f1',
  sidebarMuted: '#99a3b8',
  gold: '#d6ae51',
} as const;

/** This app's own dark variant — see the file comment above. */
export const darkColors = {
  background: '#0d1220',
  surface: '#151d33',
  page: '#0d1220',
  foreground: '#e4e9f1',
  mutedForeground: '#99a3b8',
  border: '#2a3550',
  input: '#334066',
  muted: '#1a2340',
  accent: '#1a2340',
  accentForeground: '#c5cbdb',
  secondary: '#151d33',
  secondaryForeground: '#c5cbdb',

  primary: '#5b8ae6',
  primaryHover: '#78a0ec',
  primaryForeground: '#0d1220',

  link: '#6fb3f0',
  ring: '#6fb3f0',

  destructive: '#e2615f',
  destructiveForeground: '#0d1220',

  statusGreenBg: '#133621',
  statusGreenFg: '#5fcf86',
  statusRedBg: '#3a1e1c',
  statusRedFg: '#f0847f',
  statusBlueBg: '#162a4a',
  statusBlueFg: '#7fb3f5',
  statusGrayBg: '#232a3a',
  statusGrayFg: '#a8b0bd',

  sidebar: '#0a0e18',
  sidebarForeground: '#e4e9f1',
  sidebarMuted: '#8089a0',
  gold: '#e4bf72',
} as const;

export type AppColors = Record<keyof typeof lightColors, string>;
