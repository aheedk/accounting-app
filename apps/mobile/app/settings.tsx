import { useEffect, useState } from 'react';
import { View, StyleSheet, Alert, Platform } from 'react-native';
import { Text, Appbar, List, Switch, Divider, useTheme } from 'react-native-paper';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../hooks/useAuth';
import { useThemePreference, type ThemePreference } from '../hooks/useThemePreference';
import { usePushPreference } from '../hooks/usePushPreference';
import { AppSegmentedControl } from '../components/ui/AppSegmentedControl';
import { spacing, typeScale, type AppTheme } from '../theme';

const BIOMETRIC_PASSWORD_KEY = 'acct_biometric_password';

const THEME_OPTIONS: Array<{ value: ThemePreference; label: string }> = [
  { value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' },
];

export default function SettingsScreen() {
  const theme = useTheme<AppTheme>();
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();
  const { preference, setPreference } = useThemePreference();
  const { enabled: pushEnabled, busy: pushBusy, setEnabled: setPushEnabled } = usePushPreference();
  const [biometricOn, setBiometricOn] = useState(false);

  useEffect(() => {
    void SecureStore.getItemAsync(BIOMETRIC_PASSWORD_KEY).then(saved => setBiometricOn(!!saved));
  }, []);

  async function toggleBiometric(next: boolean) {
    if (!next) {
      await SecureStore.deleteItemAsync(BIOMETRIC_PASSWORD_KEY);
      setBiometricOn(false);
      return;
    }
    // There's no plaintext password available post-login to save here — it
    // only ever gets written at the moment of a real sign-in (login.tsx).
    Alert.alert(
      'Turn on Face ID / Touch ID?',
      'Sign out and sign back in with "Remember password" checked to turn this on.',
    );
  }

  const appVersion = Constants.expoConfig?.version ?? '—';

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <Appbar.Header statusBarHeight={insets.top} style={{ backgroundColor: theme.app.surface }}>
        <Appbar.BackAction onPress={() => router.back()} color={theme.app.foreground} />
        <Appbar.Content title="Settings" titleStyle={{ color: theme.app.foreground }} />
      </Appbar.Header>

      <View style={{ paddingBottom: insets.bottom + spacing.xxl }}>
        <SectionLabel theme={theme} text="ACCOUNT" />
        <View style={styles.accountCard}>
          <Text style={{ color: theme.app.foreground, fontWeight: '700', fontSize: typeScale.h2 }}>{user?.full_name ?? '—'}</Text>
          <Text style={{ color: theme.app.mutedForeground, marginTop: 2 }}>{user?.email}</Text>
          <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption, marginTop: 2, textTransform: 'capitalize' }}>
            {user?.role?.replace('_', ' ')}
          </Text>
        </View>
        <Divider />

        <SectionLabel theme={theme} text="SECURITY" />
        <List.Item
          title="Face ID / Touch ID sign-in"
          description={biometricOn ? 'On' : 'Off'}
          titleStyle={{ color: theme.app.foreground }}
          descriptionStyle={{ color: theme.app.mutedForeground }}
          right={() => <Switch value={biometricOn} onValueChange={(v) => void toggleBiometric(v)} color={theme.app.primary} />}
        />
        <Divider />

        <SectionLabel theme={theme} text="NOTIFICATIONS" />
        <List.Item
          title="Push notifications"
          description={pushEnabled ? 'On' : 'Off — new documents, invoice payments'}
          titleStyle={{ color: theme.app.foreground }}
          descriptionStyle={{ color: theme.app.mutedForeground }}
          right={() => <Switch value={pushEnabled} disabled={pushBusy} onValueChange={(v) => void setPushEnabled(v)} color={theme.app.primary} />}
        />
        <Divider />

        <SectionLabel theme={theme} text="APPEARANCE" />
        <View style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}>
          <AppSegmentedControl value={preference} onChange={setPreference} options={THEME_OPTIONS} />
        </View>
        <Divider />

        <SectionLabel theme={theme} text="ABOUT" />
        <List.Item
          title="Version"
          description={`${appVersion} · ${Platform.OS}`}
          titleStyle={{ color: theme.app.foreground }}
          descriptionStyle={{ color: theme.app.mutedForeground }}
        />
        <Divider style={{ marginVertical: spacing.md }} />

        <List.Item
          title="Sign out"
          onPress={() => { void logout(); }}
          left={props => <List.Icon {...props} icon="logout" color={theme.app.destructive} />}
          titleStyle={{ color: theme.app.destructive, fontWeight: '600' }}
        />
      </View>
    </View>
  );
}

function SectionLabel({ theme, text }: { theme: AppTheme; text: string }) {
  return (
    <Text style={{ color: theme.app.mutedForeground, fontSize: 11, fontWeight: '700', letterSpacing: 0.5, padding: spacing.md, paddingBottom: spacing.xs }}>
      {text}
    </Text>
  );
}

const styles = StyleSheet.create({
  accountCard: { paddingHorizontal: spacing.md, paddingBottom: spacing.md },
});
