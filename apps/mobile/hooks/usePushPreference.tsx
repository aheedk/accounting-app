import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import * as SecureStore from 'expo-secure-store';
import { registerForPushNotifications, unregisterPushToken } from '../services/pushNotifications';

const PUSH_ENABLED_KEY = 'acct_push_enabled';
const PUSH_TOKEN_KEY = 'acct_push_token';

type PushPreferenceState = {
  enabled: boolean;
  /** null while the first check/registration attempt is still in flight. */
  busy: boolean;
  setEnabled: (v: boolean) => Promise<void>;
};

const PushPreferenceContext = createContext<PushPreferenceState | null>(null);

export function PushPreferenceProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabledState] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void SecureStore.getItemAsync(PUSH_ENABLED_KEY).then(saved => setEnabledState(saved === 'true'));
  }, []);

  async function setEnabled(v: boolean) {
    setBusy(true);
    try {
      if (v) {
        const token = await registerForPushNotifications();
        if (token) {
          await SecureStore.setItemAsync(PUSH_TOKEN_KEY, token);
          await SecureStore.setItemAsync(PUSH_ENABLED_KEY, 'true');
          setEnabledState(true);
        } else {
          // Permission refused, no device, or no EAS project configured yet
          // — leave the toggle off rather than claim success.
          setEnabledState(false);
        }
      } else {
        const token = await SecureStore.getItemAsync(PUSH_TOKEN_KEY);
        if (token) await unregisterPushToken(token);
        await SecureStore.deleteItemAsync(PUSH_TOKEN_KEY);
        await SecureStore.setItemAsync(PUSH_ENABLED_KEY, 'false');
        setEnabledState(false);
      }
    } finally {
      setBusy(false);
    }
  }

  const value = useMemo<PushPreferenceState>(() => ({ enabled, busy, setEnabled }), [enabled, busy]);
  return <PushPreferenceContext.Provider value={value}>{children}</PushPreferenceContext.Provider>;
}

export function usePushPreference(): PushPreferenceState {
  const ctx = useContext(PushPreferenceContext);
  if (!ctx) throw new Error('usePushPreference must be used within PushPreferenceProvider');
  return ctx;
}
