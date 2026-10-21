import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { api } from './apiClient';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false,
  }),
});

/**
 * Registration scaffolding for batch item 7 — gets an Expo push token and
 * hands it to the backend (POST /me/push-tokens). Actual delivery needs a
 * real device (the simulator/Expo Go has no APNs/FCM registration), so this
 * is written to fail quietly rather than crash when that's not available —
 * e.g. no EAS projectId configured yet, or running in the simulator.
 */
export async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) return null; // simulators/emulators can't receive push

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== 'granted') {
    const requested = await Notifications.requestPermissionsAsync();
    status = requested.status;
  }
  if (status !== 'granted') return null;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', { name: 'default', importance: Notifications.AndroidImportance.DEFAULT });
  }

  try {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    const tokenResponse = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    const token = tokenResponse.data;
    await api.post('/me/push-tokens', { token, platform: Platform.OS === 'ios' ? 'ios' : 'android' });
    return token;
  } catch {
    // No EAS project configured yet, or the push service is unreachable —
    // this is scaffolding ahead of a real device test, not a hard failure.
    return null;
  }
}

export async function unregisterPushToken(token: string): Promise<void> {
  try { await api.delete('/me/push-tokens', { data: { token } }); } catch { /* best effort */ }
}

/** Tapping a notification routes by its payload's `type` field. Only one
 * real type exists today (AI inbox); others are scaffolded for item 7's
 * later notification types (e.g. once Stripe/"invoice paid" exists). */
export type NotificationPayload =
  | { type: 'inbox_new_documents'; import_id?: string }
  | { type: 'invoice_paid'; invoice_id: string };

export function addNotificationResponseHandler(onPayload: (payload: NotificationPayload) => void) {
  return Notifications.addNotificationResponseReceivedListener(response => {
    const data = response.notification.request.content.data as Partial<NotificationPayload> | undefined;
    if (data && 'type' in data) onPayload(data as NotificationPayload);
  });
}
