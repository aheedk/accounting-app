import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { AppState, type AppStateStatus, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { PaperProvider } from 'react-native-paper';
import { QueryClient, QueryClientProvider, focusManager, onlineManager } from '@tanstack/react-query';
import NetInfo from '@react-native-community/netinfo';
import 'react-native-reanimated';

import { AuthProvider } from '../hooks/useAuth';
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
  const colorScheme = useColorScheme();
  const theme = colorScheme === 'dark' ? appDarkTheme : appLightTheme;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
    void SplashScreen.hideAsync();
  }, []);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <PaperProvider theme={theme}>
          <AuthProvider>
            <NoConnectionBanner />
            <Stack screenOptions={{ headerShown: false }} />
          </AuthProvider>
        </PaperProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

// Re-fetch stale queries when the app comes back to the foreground, same as
// a browser tab regaining focus on web.
AppState.addEventListener('change', (status: AppStateStatus) => {
  focusManager.setFocused(status === 'active');
});
