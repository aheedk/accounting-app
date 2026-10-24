import { Pressable, StyleSheet } from 'react-native';
import { useTheme } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCanOpen } from '../lib/roleAccess';
import type { AppTheme } from '../theme';

// Replaces the old center "+" bottom tab — the Create screen moved out of
// the (tabs) group entirely (to app/create.tsx, same fix already applied to
// clients.tsx: routing to a *hidden* tab inside (tabs) unreliably falls back
// to Dashboard in this app, confirmed in an earlier chunk), so this floats
// above all three remaining tabs instead. 49 is the standard iOS tab bar
// content height — there's no stable cross-platform hook for the real
// rendered height available here (expo-router vendors its own internal copy
// of @react-navigation/bottom-tabs, not one this app can import directly),
// so this follows the same "insets + a known constant" approach AppHeader
// already uses for its own safe-area math.
const TAB_BAR_HEIGHT = 49;

export function CreateFab() {
  const theme = useTheme<AppTheme>();
  const insets = useSafeAreaInsets();
  const canOpen = useCanOpen();

  if (!canOpen('/expense/new')) return null;

  return (
    <Pressable
      onPress={() => router.push('/create')}
      style={[
        styles.fab,
        {
          bottom: insets.bottom + TAB_BAR_HEIGHT + 24,
          backgroundColor: theme.app.primary,
        },
      ]}
    >
      <MaterialCommunityIcons name="plus" size={24} color={theme.app.primaryForeground} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute', right: 24, width: 56, height: 56, borderRadius: 28,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 4,
    elevation: 6,
  },
});
