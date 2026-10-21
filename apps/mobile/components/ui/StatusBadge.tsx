import { View } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { fontFamily, type AppTheme } from '../../theme';

/** Matches web's Badge (apps/web/src/components/ui/badge.tsx) exactly —
 * pill shape, the same 4 status colors (green Posted/Active, red Voided,
 * blue Imported, gray Draft). Consolidates the ad-hoc StatusPill/StatusPill
 * functions that had been copy-pasted per screen. */
export type BadgeStatus = 'green' | 'red' | 'blue' | 'gray';

const STATUS_MAP: Record<string, BadgeStatus> = {
  posted: 'green', paid: 'green', active: 'green', approved: 'green',
  voided: 'red', rejected: 'red',
  imported: 'blue',
  draft: 'gray', pending: 'gray',
};

export function statusToBadge(status: string): BadgeStatus {
  return STATUS_MAP[status.toLowerCase()] ?? 'gray';
}

export function StatusBadge({ status, label }: { status: BadgeStatus; label: string }) {
  const theme = useTheme<AppTheme>();
  const colors: Record<BadgeStatus, { bg: string; fg: string }> = {
    green: { bg: theme.app.statusGreenBg, fg: theme.app.statusGreenFg },
    red: { bg: theme.app.statusRedBg, fg: theme.app.statusRedFg },
    blue: { bg: theme.app.statusBlueBg, fg: theme.app.statusBlueFg },
    gray: { bg: theme.app.statusGrayBg, fg: theme.app.statusGrayFg },
  };
  const c = colors[status];
  return (
    <View style={{ backgroundColor: c.bg, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, alignSelf: 'flex-start' }}>
      <Text style={{ color: c.fg, fontSize: 11, fontFamily: fontFamily.medium, textTransform: 'capitalize' }}>{label}</Text>
    </View>
  );
}
