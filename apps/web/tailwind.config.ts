import type { Config } from 'tailwindcss';

export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    container: { center: true, padding: '2rem', screens: { '2xl': '1400px' } },
    extend: {
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'sans-serif'],
        display: ['Fraunces', 'Georgia', 'serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        page: 'hsl(var(--page))',
        primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))', hover: 'hsl(var(--primary-hover))' },
        secondary: { DEFAULT: 'hsl(var(--secondary))', foreground: 'hsl(var(--secondary-foreground))' },
        destructive: { DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))' },
        muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        accent: { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
        card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
        link: 'hsl(var(--link))',
        status: {
          green: { bg: 'hsl(var(--status-green-bg))', fg: 'hsl(var(--status-green-fg))' },
          red: { bg: 'hsl(var(--status-red-bg))', fg: 'hsl(var(--status-red-fg))' },
          blue: { bg: 'hsl(var(--status-blue-bg))', fg: 'hsl(var(--status-blue-fg))' },
          gray: { bg: 'hsl(var(--status-gray-bg))', fg: 'hsl(var(--status-gray-fg))' },
        },
        sidebar: {
          DEFAULT: 'hsl(var(--sidebar))',
          foreground: 'hsl(var(--sidebar-foreground))',
          muted: 'hsl(var(--sidebar-muted))',
          hover: 'hsl(var(--sidebar-hover))',
          active: 'hsl(var(--sidebar-active))',
        },
        gold: 'hsl(var(--gold))',
      },
      boxShadow: {
        card: '0 1px 2px rgba(20, 29, 51, 0.05), 0 1px 3px rgba(20, 29, 51, 0.06)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
} satisfies Config;
