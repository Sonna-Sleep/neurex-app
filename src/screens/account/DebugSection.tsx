// __DEV__-only section in the Account screen that lets us drive the full
// upload→cloud→Supabase loop manually, without firmware BLE.
//
// Steps the user can do:
//   1. Tap "pick eeg.bin" → expo-document-picker selects a local BIN
//   2. Optionally pick epochs.bin / stims.bin as well
//   3. Tap "upload to cloud" → uploadRecording() POSTs to Modal
//   4. On success: stores session_id in zustand → Home shows ProcessingCard
//   5. ProcessingCard polls Supabase, fires notification when ready
//
// Hidden in production builds (gated on __DEV__).

import React, { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';

import { Button } from '../../components/Button';
import { Body, Eyebrow, SerifHeadline } from '../../theme/typography';
import { colors, spacing } from '../../theme/tokens';
import { uploadRecording } from '../../lib/upload/uploadRecording';
import { UploadError } from '../../lib/upload/errors';
import { useSession } from '../../state/session';

type PickedFile = { uri: string; name: string };

export function DebugSection() {
  if (!__DEV__) return null;

  const setProcessingSessionId = useSession((s) => s.setProcessingSessionId);
  const [eeg, setEeg] = useState<PickedFile | null>(null);
  const [epochs, setEpochs] = useState<PickedFile | null>(null);
  const [stims, setStims] = useState<PickedFile | null>(null);
  const [uploading, setUploading] = useState(false);

  const pick = async (
    setter: (f: PickedFile | null) => void,
  ) => {
    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      type: '*/*',
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    setter({ uri: asset.uri, name: asset.name });
  };

  const upload = async () => {
    if (!eeg) {
      Alert.alert('Pick eeg.bin first');
      return;
    }
    setUploading(true);
    try {
      const { sessionId } = await uploadRecording({
        eeg,
        epochs: epochs ?? undefined,
        stims: stims ?? undefined,
      });
      setProcessingSessionId(sessionId);
      Alert.alert(
        'Upload complete',
        `Server returned session ${sessionId}. Switch to Home to watch it process.`,
      );
    } catch (e) {
      const message = e instanceof UploadError ? e.message : String(e);
      Alert.alert('Upload failed', message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <View style={styles.section}>
      <Eyebrow>debug · upload test</Eyebrow>
      <View style={styles.body}>
        <SerifHeadline style={styles.heading}>Send a BIN to Modal</SerifHeadline>
        <Body style={styles.muted}>
          Picks files from device storage, POSTs them to the Modal endpoint
          with your Supabase JWT, and routes the response through the same
          path firmware BLE will use later.
        </Body>

        <FilePickRow label="eeg.bin (required)" file={eeg} onPick={() => pick(setEeg)} />
        <FilePickRow label="epochs.bin (optional)" file={epochs} onPick={() => pick(setEpochs)} />
        <FilePickRow label="stims.bin (optional)" file={stims} onPick={() => pick(setStims)} />

        <View style={styles.uploadAction}>
          <Button
            label={uploading ? 'uploading…' : 'upload to cloud'}
            onPress={upload}
            disabled={uploading || !eeg}
          />
        </View>
      </View>
    </View>
  );
}

function FilePickRow({
  label,
  file,
  onPick,
}: {
  label: string;
  file: PickedFile | null;
  onPick: () => void;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Body>{label}</Body>
        <Body style={styles.muted} numberOfLines={1}>
          {file ? file.name : 'no file selected'}
        </Body>
      </View>
      <Button label={file ? 'change' : 'pick'} variant="ghost" onPress={onPick} />
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    paddingVertical: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    gap: spacing.sm,
  },
  body: {
    paddingTop: spacing.sm,
    gap: spacing.md,
  },
  heading: {
    fontSize: 18,
  },
  muted: {
    color: colors.textSecondary,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  rowText: {
    flexShrink: 1,
    gap: spacing.xs,
  },
  uploadAction: {
    paddingTop: spacing.sm,
  },
});
