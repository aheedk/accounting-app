import { View } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { AppHeader } from '../components/AppHeader';
import { AppCard } from '../components/ui/AppCard';
import { CameraCaptureButton } from '../components/CameraCaptureButton';
import { spacing, typeScale, fontFamily, type AppTheme } from '../theme';

// A dedicated landing page for the same upload flow the camera icon in
// other screens' headers already exposes (CameraCaptureButton — camera /
// library / Files, all POSTing to the one /ai/documents pipeline). Web's
// client-only SendDocumentsPage.tsx is the closer analog, but the backend
// gate is just refuseViewOnly (any non-viewer, client included) — so this
// screen is open to the same set of roles, not client-only.
export default function SendDocumentsScreen() {
  const theme = useTheme<AppTheme>();

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title="Send Documents" />
      <View style={{ padding: spacing.md }}>
        <AppCard style={{ padding: spacing.lg, alignItems: 'center', gap: spacing.md }}>
          <View style={{
            width: 56, height: 56, borderRadius: 28, backgroundColor: theme.app.muted,
            alignItems: 'center', justifyContent: 'center',
          }}>
            <MaterialCommunityIcons name="file-upload-outline" size={28} color={theme.app.primary} />
          </View>
          <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.semibold, fontSize: typeScale.h3, textAlign: 'center' }}>
            Send a bank statement, bill, invoice, or check stub
          </Text>
          <Text style={{ color: theme.app.mutedForeground, textAlign: 'center' }}>
            Take a photo, choose a photo from your library, or pick a file already saved on this device.
            It's read automatically and routed to the right place — statements land in the inbox,
            invoices and check stubs are reviewed from the web app.
          </Text>
          <CameraCaptureButton />
        </AppCard>
      </View>
    </View>
  );
}
