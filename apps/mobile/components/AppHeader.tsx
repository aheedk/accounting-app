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
 * Two rows, not one: cramming the business name and the page title into a
 * single row made both compete for space and truncate — a small business
 * name row up top, a bigger page-title row below, so each reads as its own
 * thing instead of blurring into "Green Gadget..General Ledger".
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
      <View style={styles.topRow}>
        {leading === 'menu' ? (
          <>
            <IconButton icon="menu" size={20} onPress={openDrawer} iconColor={theme.app.mutedForeground} style={styles.menuBtn} />
            <Menu
              visible={switcherOpen}
              onDismiss={() => setSwitcherOpen(false)}
              anchor={
                <Pressable onPress={() => setSwitcherOpen(true)} style={styles.businessPress}>
                  <Text
                    style={{ color: theme.app.mutedForeground, fontFamily: fontFamily.semibold, fontSize: typeScale.caption, textTransform: 'uppercase', letterSpacing: 0.3 }}
                    numberOfLines={1}
                  >
                    {activeBusiness?.name ?? 'Pick business'}
                  </Text>
                  <Text style={{ color: theme.app.mutedForeground, fontSize: 10 }}>▾</Text>
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
          <Text style={{ color: theme.app.mutedForeground, fontFamily: fontFamily.semibold, fontSize: typeScale.caption, textTransform: 'uppercase', letterSpacing: 0.3, paddingLeft: spacing.md }} numberOfLines={1}>
            {activeBusiness?.name ?? ''}
          </Text>
        )}

        <View style={styles.spacer} />

        <IconButton icon="bell-outline" size={18} onPress={() => router.push('/settings')} iconColor={theme.app.mutedForeground} style={styles.smallBtn} />
        <Pressable onPress={() => router.push('/settings')} style={[styles.avatar, { backgroundColor: theme.app.primary }]}>
          <Text style={{ color: theme.app.primaryForeground, fontFamily: fontFamily.semibold, fontSize: 11 }}>{initials}</Text>
        </Pressable>
      </View>

      <View style={styles.titleRow}>
        {leading === 'back' ? (
          <IconButton icon="arrow-left" size={22} onPress={() => router.back()} iconColor={theme.app.foreground} style={styles.backBtn} />
        ) : null}
        <Text style={[styles.titleText, { color: theme.app.foreground }]} numberOfLines={1}>
          {title}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { borderBottomWidth: StyleSheet.hairlineWidth, paddingBottom: spacing.sm },
  topRow: { flexDirection: 'row', alignItems: 'center', height: 30, paddingRight: spacing.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: spacing.xs },
  titleText: { fontFamily: fontFamily.bold, fontSize: typeScale.h1 },
  spacer: { flex: 1 },
  menuBtn: { margin: 0, marginLeft: 2 },
  backBtn: { margin: 0 },
  smallBtn: { margin: 0 },
  businessPress: { flexDirection: 'row', alignItems: 'center', gap: 3, flexShrink: 1, paddingVertical: 4, paddingRight: spacing.xs },
  avatar: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginLeft: 4 },
});
