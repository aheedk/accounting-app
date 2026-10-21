import { View, StyleSheet, Pressable } from 'react-native';
import { Text, IconButton, Menu, useTheme } from 'react-native-paper';
import { useState } from 'react';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../hooks/useAuth';
import { useNavDrawer } from '../hooks/useNavDrawer';
import { fontFamily, typeScale, spacing, type AppTheme } from '../theme';

/**
 * The persistent top bar every screen shares — mirrors apps/web's TopBar.tsx
 * (hamburger, business switcher, centered content, account/sign-out on the
 * right), adapted per the brief: a notification bell and initials avatar
 * instead of the web's full search bar + name + role badge (those don't fit
 * a phone-width header the same way).
 *
 * `leading="menu"` is the primary nav entry point (opens the drawer);
 * `leading="back"` is for screens pushed from somewhere else (a detail
 * screen), which keep normal back-navigation instead of re-opening the
 * drawer.
 */
export function AppHeader({ title, leading = 'menu' }: { title: string; leading?: 'menu' | 'back' }) {
  const theme = useTheme<AppTheme>();
  const insets = useSafeAreaInsets();
  const { businesses, activeBusinessId, setActiveBusinessId, user } = useAuth();
  const { open: openDrawer } = useNavDrawer();
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const activeBusiness = businesses.find(b => b.id === activeBusinessId);
  const initials = (user?.full_name ?? '?').split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();

  return (
    <View style={[styles.header, { paddingTop: insets.top, backgroundColor: theme.app.surface, borderBottomColor: theme.app.border }]}>
      <View style={styles.row}>
        <View style={styles.left}>
          {leading === 'menu' ? (
            <>
              <IconButton icon="menu" size={22} onPress={openDrawer} iconColor={theme.app.foreground} style={styles.iconBtn} />
              <Menu
                visible={switcherOpen}
                onDismiss={() => setSwitcherOpen(false)}
                anchor={
                  <Pressable onPress={() => setSwitcherOpen(true)} style={styles.businessPress}>
                    <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.semibold, fontSize: typeScale.body }} numberOfLines={1}>
                      {activeBusiness?.name ?? 'Pick business'}
                    </Text>
                  </Pressable>
                }
              >
                {businesses.map(b => (
                  <Menu.Item
                    key={b.id}
                    title={b.name}
                    onPress={() => { setActiveBusinessId(b.id); setSwitcherOpen(false); }}
                    trailingIcon={b.id === activeBusinessId ? 'check' : undefined}
                  />
                ))}
              </Menu>
            </>
          ) : (
            <IconButton icon="arrow-left" size={22} onPress={() => router.back()} iconColor={theme.app.foreground} style={styles.iconBtn} />
          )}
        </View>

        <View style={styles.center}>
          <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.semibold, fontSize: typeScale.h3 }} numberOfLines={1}>
            {title}
          </Text>
        </View>

        <View style={styles.right}>
          <IconButton icon="bell-outline" size={20} onPress={() => router.push('/settings')} iconColor={theme.app.mutedForeground} style={styles.iconBtn} />
          <Pressable onPress={() => router.push('/settings')} style={[styles.avatar, { backgroundColor: theme.app.primary }]}>
            <Text style={{ color: theme.app.primaryForeground, fontFamily: fontFamily.semibold, fontSize: 12 }}>{initials}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { borderBottomWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'center', height: 52, paddingHorizontal: spacing.xs },
  left: { flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0 },
  center: { flex: 1.4, alignItems: 'center', paddingHorizontal: spacing.xs },
  right: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', flex: 1, gap: 4 },
  iconBtn: { margin: 0 },
  businessPress: { flexShrink: 1, paddingVertical: spacing.sm, paddingRight: spacing.xs },
  avatar: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginLeft: 4 },
});
