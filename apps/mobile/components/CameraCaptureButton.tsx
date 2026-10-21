import { useState } from 'react';
import { Alert } from 'react-native';
import { IconButton, ActivityIndicator, useTheme } from 'react-native-paper';
import * as ImagePicker from 'expo-image-picker';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useAuth } from '../hooks/useAuth';
import { uploadDocument, type DocumentUploadResult } from '../services/api';
import { pickErr } from '../services/apiClient';
import type { AppTheme } from '../theme';

// The "killer mobile feature": snap a photo of a receipt/bill and it goes
// straight into the same AI extraction pipeline a bank-statement PDF upload
// uses (POST /businesses/:businessId/ai/documents) — one endpoint handles
// both, per the backend research. Kept deliberately simple per the brief:
// open camera, take photo, upload, show a processing state. No cropping/
// retake UI, no batch upload — one photo at a time.

function guessMimeType(uri: string, reported?: string): string {
  if (reported) return reported;
  const ext = uri.split('.').pop()?.toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  return 'image/jpeg'; // the server's allowlist doesn't include HEIC — camera captures are jpeg on both platforms by default
}

export function CameraCaptureButton() {
  const theme = useTheme<AppTheme>();
  const { activeBusinessId } = useAuth();
  const queryClient = useQueryClient();
  const [uploading, setUploading] = useState(false);

  async function pickAndUpload(source: 'camera' | 'library') {
    const permission = source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', `Allow access to your ${source === 'camera' ? 'camera' : 'photos'} to capture a document.`);
      return;
    }

    const result = source === 'camera'
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];
    if (!activeBusinessId) return;
    setUploading(true);
    try {
      const uploaded = await uploadDocument(activeBusinessId, {
        uri: asset.uri,
        name: asset.fileName ?? `capture-${Date.now()}.jpg`,
        type: guessMimeType(asset.uri, asset.mimeType),
      });
      await handleUploadResult(uploaded);
    } catch (e) {
      Alert.alert('Couldn\'t process that document', pickErr(e));
    } finally {
      setUploading(false);
    }
  }

  async function handleUploadResult(result: DocumentUploadResult) {
    // No mobile review screen exists yet for invoice imports or check
    // stubs (scoped out — Phase 1 only built the bank/card statement
    // inbox) — say plainly where it landed instead of pretending there's
    // somewhere to tap through to.
    switch (result.kind) {
      case 'bank_statement':
      case 'credit_card_statement':
        await queryClient.invalidateQueries({ queryKey: ['email-imports', activeBusinessId] });
        router.push({ pathname: '/inbox/[id]', params: { id: result.staging_id } });
        return;
      case 'invoice':
        Alert.alert('Uploaded', 'Read as an invoice/bill — review it from the Invoice Imports queue on the web app.');
        return;
      case 'check_stubs':
        Alert.alert('Uploaded', `Read as ${result.check_count} check stub${result.check_count === 1 ? '' : 's'} — review from the web app.`);
    }
  }

  function openPicker() {
    Alert.alert('Add a document', 'Take a photo of a receipt, bill, or statement', [
      { text: 'Take Photo', onPress: () => void pickAndUpload('camera') },
      { text: 'Choose from Library', onPress: () => void pickAndUpload('library') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  if (uploading) {
    return <ActivityIndicator size="small" color={theme.app.primary} style={{ padding: 8 }} />;
  }

  return (
    <IconButton
      icon="camera-outline"
      size={24}
      iconColor={theme.app.primary}
      onPress={openPicker}
      accessibilityLabel="Capture a document"
    />
  );
}

