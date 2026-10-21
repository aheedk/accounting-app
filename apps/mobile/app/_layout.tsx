import { useEffect, useState } from 'react';
import { Stack, router } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { AppState, type AppStateStatus } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { PaperProvider } from 'react-native-paper';
import { QueryClient, QueryClientProvider, focusManager, onlineManager } from '@tanstack/react-query';
import NetInfo from '@react-native-community/netinfo';
import 'react-native-reanimated';

import { AuthProvider } from '../hooks/useAuth';
import { ThemePreferenceProvider, useThemePreference } from '../hooks/useThemePreference';
import { PushPreferenceProvider } from '../hooks/usePushPreference';
import { addNotificationResponseHandler } from '../services/pushNotifications';
import { appLightTheme, appDarkTheme } from '../theme';
import { NoConnectionBanner } from '../components/NoConnectionBanner';

export { ErrorBoundary } from 'expo-router';
export const unstable_settings = { anchor: '(tabs)' };

SplashScreen.preventAutoHideAsync();

// Item 6, v1 scope: online-only, but React Query's own offline primitives
// (onlineManager + its built-in mutation retry/pause-on-offline) are wired up
// now so a later v2 doesn't have to revisit this file — just add the
// persistent cache and let queued mutations resume instead of failing.
onlineManager.setEventListener(setOnline => {
  return NetInfo.addEventListener(state => setOnline(!!state.isConnected));
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 60_000, retry: 1 },
    mutations: { retry: 1 },
  },
});

export default function RootLayout() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
    void SplashScreen.hideAsync();
  }, []);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <ThemePreferenceProvider>
          <ThemedApp />
        </ThemePreferenceProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

// Reads the Settings screen's theme choice (light/dark/system) — split out
// from RootLayout so it can call useThemePreference, which needs to be
// inside ThemePreferenceProvider.
function ThemedApp() {
  const { resolvedScheme } = useThemePreference();
  const theme = resolvedScheme === 'dark' ? appDarkTheme : appLightTheme;

  // Tapping a notification routes by its payload's `type` — only the AI
  // inbox case is real today (see services/pushNotifications.ts); other
  // types are scaffolded for item 7's later notification types.
  useEffect(() => {
    const sub = addNotificationResponseHandler(payload => {
      if (payload.type === 'inbox_new_documents') {
        router.push(payload.import_id ? { pathname: '/inbox/[id]', params: { id: payload.import_id } } : '/inbox');
      } else if (payload.type === 'invoice_paid') {
        router.push({ pathname: '/invoice/[id]', params: { id: payload.invoice_id } });
      }
    });
    return () => sub.remove();
  }, []);

  return (
    <PaperProvider theme={theme}>
      <AuthProvider>
        <PushPreferenceProvider>
          <NoConnectionBanner />
          <Stack screenOptions={{ headerShown: false }} />
        </PushPreferenceProvider>
      </AuthProvider>
    </PaperProvider>
  );
}

// Re-fetch stale queries when the app comes back to the foreground, same as
// a browser tab regaining focus on web.
AppState.addEventListener('change', (status: AppStateStatus) => {
  focusManager.setFocused(status === 'active');
});
