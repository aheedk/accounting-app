import { View, StyleSheet } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { FlashList } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../hooks/useAuth';
import { AppHeader } from '../components/AppHeader';
import { StatusBadge } from '../components/ui/StatusBadge';
import { listFirmUsers, type FirmUserRow } from '../services/api';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import { fmtShortDate } from '../lib/money';
import { spacing, typeScale, fontFamily, type AppTheme } from '../theme';

// /me/firm/users is firm_admin-only server-side — gated here too so a
// non-admin gets a clear message instead of a 403 from a bare fetch.

/**
 * Firm-level (not business-scoped — one roster of everyone with access to
 * the firm). Deliberately read-only: invite, deactivate, role changes,
 * password reset, and 2FA reset all exist server-side but are high-
 * blast-radius account-security actions not built on mobile without a
 * dedicated security review first — this is a view, not an admin panel.
 */
export default function UsersScreen() {
  const theme = useTheme<AppTheme>();
  const { activeBusinessId, user } = useAuth();
  const isFirmAdmin = user?.role === 'firm_admin';

  const query = useQuery({
    queryKey: ['firm-users'],
    queryFn: () => listFirmUsers(),
    enabled: !!activeBusinessId && isFirmAdmin,
  });

  if (!isFirmAdmin) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <AppHeader title="Users" />
        <View style={{ padding: spacing.lg, alignItems: 'center' }}>
          <Text style={{ color: theme.app.mutedForeground, textAlign: 'center' }}>
            Only a firm admin can see the firm's user list.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title="Users" />

      {query.isLoading ? (
        <LoadingIndicator />
      ) : query.error ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : (
        <FlashList
          data={query.data ?? []}
          keyExtractor={u => u.id}
          contentContainerStyle={{ paddingBottom: spacing.xxl }}
          ItemSeparatorComponent={() => <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.app.border }} />}
          ListEmptyComponent={<EmptyState icon="account-group-outline" message="No users found." />}
          renderItem={({ item }: { item: FirmUserRow }) => <UserRow user={item} theme={theme} />}
        />
      )}
    </View>
  );
}

function UserRow({ user, theme }: { user: FirmUserRow; theme: AppTheme }) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.medium }} numberOfLines={1}>{user.full_name}</Text>
        <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }} numberOfLines={1}>
          {user.email} · {user.role.replace('_', ' ')}
        </Text>
        <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>
          {user.last_login_at ? `Last login ${fmtShortDate(user.last_login_at)}` : 'Never signed in'}
        </Text>
      </View>
      {user.deactivated_at ? (
        <StatusBadge status="gray" label="Deactivated" />
      ) : user.locked ? (
        <StatusBadge status="red" label="Locked" />
      ) : (
        <StatusBadge status="green" label="Active" />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
});
