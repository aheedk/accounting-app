import { useEffect, useState } from 'react';
import { View, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { Text, TextInput, Button, useTheme } from 'react-native-paper';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../hooks/useAuth';
import { LoadingIndicator } from '../../components/LoadingIndicator';
import { spacing, typeScale, minTouchTarget, type AppTheme } from '../../theme';

const REMEMBERED_EMAIL_KEY = 'acct_remembered_email';

export default function LoginScreen() {
  const theme = useTheme<AppTheme>();
  const insets = useSafeAreaInsets();
  const { login, error } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);

  useEffect(() => {
    void (async () => {
      const remembered = await SecureStore.getItemAsync(REMEMBERED_EMAIL_KEY);
      if (remembered) setEmail(remembered);
      const [hasHardware, enrolled] = await Promise.all([
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
      ]);
      setBiometricAvailable(hasHardware && enrolled && !!remembered);
    })();
  }, []);

  async function submit() {
    if (!email || !password || busy) return;
    setBusy(true);
    try {
      await login(email, password);
      await SecureStore.setItemAsync(REMEMBERED_EMAIL_KEY, email);
      // Keychain/Keystore-backed, same as the access token — gated behind a
      // biometric prompt on the way back out (unlockWithBiometrics), not
      // plain on-device storage. Only remembered when biometric hardware is
      // actually set up, so a device with neither Face ID nor a passcode
      // enrolled never gets a password written to it this way.
      const [hasHardware, enrolled] = await Promise.all([
        LocalAuthentication.hasHardwareAsync(), LocalAuthentication.isEnrolledAsync(),
      ]);
      if (hasHardware && enrolled) {
        await SecureStore.setItemAsync('acct_biometric_password', password);
        setBiometricAvailable(true);
      }
    } catch {
      // error already surfaced via useAuth().error
    } finally {
      setBusy(false);
    }
  }

  // Biometric unlock only re-enters a password already saved on this device
  // in SecureStore's own encrypted store — it is a convenience for a
  // returning user, never a replacement for the first real password login.
  async function unlockWithBiometrics() {
    const result = await LocalAuthentication.authenticateAsync({ promptMessage: 'Unlock to sign in' });
    if (!result.success) return;
    const savedPassword = await SecureStore.getItemAsync('acct_biometric_password');
    const savedEmail = await SecureStore.getItemAsync(REMEMBERED_EMAIL_KEY);
    if (!savedPassword || !savedEmail) return;
    setBusy(true);
    try { await login(savedEmail, savedPassword); } catch { /* surfaced via error */ }
    finally { setBusy(false); }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.app.sidebar }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.container, { paddingTop: insets.top + spacing.xxl, paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={styles.brand}>
          <View style={[styles.logoMark, { backgroundColor: theme.app.primary }]}>
            <Text style={{ color: '#fff', fontSize: 22, fontWeight: '700' }}>A</Text>
          </View>
          <Text style={[styles.brandName, { color: theme.app.sidebarForeground }]}>Accounting</Text>
        </View>

        <View style={[styles.card, { backgroundColor: theme.app.surface }]}>
          <Text style={{ fontSize: typeScale.h1, fontWeight: '700', color: theme.app.foreground, marginBottom: spacing.lg }}>
            Sign in
          </Text>

          <TextInput
            mode="outlined"
            label="Email"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
            style={styles.input}
          />
          <TextInput
            mode="outlined"
            label="Password"
            secureTextEntry
            autoComplete="password"
            value={password}
            onChangeText={setPassword}
            style={styles.input}
            onSubmitEditing={() => { void submit(); }}
          />

          {error && <Text style={{ color: theme.app.destructive, marginBottom: spacing.sm }}>{error}</Text>}

          <Button
            mode="contained"
            onPress={() => { void submit(); }}
            disabled={busy || !email || !password}
            style={{ minHeight: minTouchTarget, justifyContent: 'center', marginTop: spacing.sm }}
          >
            {busy ? <LoadingIndicator size="sm" /> : 'Sign in'}
          </Button>

          {biometricAvailable && (
            <Button mode="text" onPress={() => { void unlockWithBiometrics(); }} style={{ marginTop: spacing.sm }}>
              Unlock with Face ID / Touch ID
            </Button>
          )}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: spacing.lg, justifyContent: 'center' },
  brand: { alignItems: 'center', marginBottom: spacing.xl },
  logoMark: { width: 56, height: 56, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm },
  brandName: { fontSize: typeScale.h2, fontWeight: '600' },
  card: { borderRadius: 16, padding: spacing.lg },
  input: { marginBottom: spacing.md },
});
