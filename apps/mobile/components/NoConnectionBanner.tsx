import { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { useTheme } from 'react-native-paper';
import type { AppTheme } from '../theme';

/** Item 6: v1 is online-only everywhere, but the app should always say so
 * plainly rather than fail silently mid-screen. */
export function NoConnectionBanner() {
  const theme = useTheme<AppTheme>();
  const [online, setOnline] = useState(true);

  useEffect(() => NetInfo.addEventListener(state => setOnline(state.isConnected !== false)), []);

  if (online) return null;

  return (
    <View style={[styles.banner, { backgroundColor: theme.app.statusRedBg }]}>
      <Text style={[styles.text, { color: theme.app.statusRedFg }]}>No connection — showing the last data loaded</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { paddingVertical: 6, paddingHorizontal: 12, alignItems: 'center' },
  text: { fontSize: 12, fontWeight: '600' },
});
