import { type ReactNode } from 'react';
import { Menu } from 'react-native-paper';
import { useTheme } from 'react-native-paper';
import { radius, fontFamily, typeScale, type AppTheme } from '../../theme';

/**
 * A thin wrapper around Paper's `Menu`/`Menu.Item` — reused for the anchor
 * measurement/positioning/screen-edge handling Paper already gets right
 * (not worth rebuilding), but restyled to match web's shadcn
 * `dropdown-menu.tsx`: a bordered, shadowed, rounded-md panel instead of
 * Paper's elevated Material surface, and item text/colors pulled from our
 * own theme tokens instead of Paper's defaults.
 */
export function AppMenu({
  visible, onDismiss, anchor, children,
}: {
  visible: boolean;
  onDismiss: () => void;
  anchor: ReactNode;
  children: ReactNode;
}) {
  const theme = useTheme<AppTheme>();
  const c = theme.app;
  return (
    <Menu
      visible={visible}
      onDismiss={onDismiss}
      anchor={anchor}
      contentStyle={{
        backgroundColor: c.surface, borderRadius: radius, borderWidth: 1, borderColor: c.border,
      }}
    >
      {children}
    </Menu>
  );
}

export function AppMenuItem({
  title, onPress, leadingIcon, trailingIcon, disabled, destructive,
}: {
  title: string;
  onPress: () => void;
  leadingIcon?: string;
  trailingIcon?: string;
  disabled?: boolean;
  destructive?: boolean;
}) {
  const theme = useTheme<AppTheme>();
  const c = theme.app;
  const color = disabled ? c.mutedForeground : destructive ? c.destructive : c.foreground;
  return (
    <Menu.Item
      title={title}
      onPress={onPress}
      leadingIcon={leadingIcon}
      trailingIcon={trailingIcon}
      disabled={disabled}
      titleStyle={{ color, fontFamily: fontFamily.medium, fontSize: typeScale.body }}
    />
  );
}
