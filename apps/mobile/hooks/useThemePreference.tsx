import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import * as SecureStore from 'expo-secure-store';

export type ThemePreference = 'system' | 'light' | 'dark';
const THEME_PREFERENCE_KEY = 'acct_theme_preference';

type ThemePreferenceState = {
  preference: ThemePreference;
  setPreference: (p: ThemePreference) => void;
  /** What to actually render — 'system' resolved against the device's own scheme. */
  resolvedScheme: 'light' | 'dark';
};

const ThemePreferenceContext = createContext<ThemePreferenceState | null>(null);

export function ThemePreferenceProvider({ children }: { children: ReactNode }) {
  const deviceScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('system');

  useEffect(() => {
    void SecureStore.getItemAsync(THEME_PREFERENCE_KEY).then(saved => {
      if (saved === 'light' || saved === 'dark' || saved === 'system') setPreferenceState(saved);
    });
  }, []);

  function setPreference(p: ThemePreference) {
    setPreferenceState(p);
    void SecureStore.setItemAsync(THEME_PREFERENCE_KEY, p);
  }

  const resolvedScheme: 'light' | 'dark' = preference === 'system' ? (deviceScheme === 'dark' ? 'dark' : 'light') : preference;

  const value = useMemo<ThemePreferenceState>(
    () => ({ preference, setPreference, resolvedScheme }),
    [preference, resolvedScheme],
  );

  return <ThemePreferenceContext.Provider value={value}>{children}</ThemePreferenceContext.Provider>;
}

export function useThemePreference(): ThemePreferenceState {
  const ctx = useContext(ThemePreferenceContext);
  if (!ctx) throw new Error('useThemePreference must be used within ThemePreferenceProvider');
  return ctx;
}
