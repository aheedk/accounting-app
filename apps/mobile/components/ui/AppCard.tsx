import { View, type ViewProps } from 'react-native';
import { useTheme } from 'react-native-paper';
import { radius, type AppTheme } from '../../theme';

/** Matches web's Card: white surface, our border, our 6px radius — not
 * Paper's default elevated-Card shadow/shape. */
export function AppCard({ style, children, ...rest }: ViewProps) {
  const theme = useTheme<AppTheme>();
  return (
    <View
      style={[
        { backgroundColor: theme.app.surface, borderWidth: 1, borderColor: theme.app.border, borderRadius: radius },
        style,
      ]}
      {...rest}
    >
      {children}
    </View>
  );
}
