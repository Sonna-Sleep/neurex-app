// Profile photo handling. The image is stored DEVICE-LOCALLY: we copy the
// picked file into the app's documentDirectory and keep its uri in the session
// store (persisted). No backend/bucket involved — simple and beta-ready. Cloud
// sync across devices would be a future upgrade.
import { Alert, Linking } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { File, Paths } from 'expo-file-system';

import { useSession } from '../state/session';

// Best-effort delete of a previously stored avatar file so we don't leak old
// copies and so a reused path never serves a stale, cached image.
function deleteFileQuietly(uri: string | null) {
  if (!uri) return;
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // The uri may be unparseable or already gone — nothing to clean up.
  }
}

export async function pickAndSaveAvatar(): Promise<void> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    Alert.alert(
      'Photo access needed',
      'Allow photo access so you can choose a profile picture.',
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'Open Settings', onPress: () => Linking.openSettings() },
      ],
    );
    return;
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.8,
  });
  if (result.canceled || !result.assets?.length) return;

  const srcUri = result.assets[0].uri;
  const ext = (srcUri.split('?')[0].split('.').pop() || 'jpg').toLowerCase();

  const { user, avatarUri: prev, setAvatar } = useSession.getState();
  const userId = user?.id ?? 'me';
  // Unique filename per pick → the new uri differs from the old, so <Image>
  // never shows a cached previous photo. We delete the prior file ourselves.
  const dest = new File(Paths.document, `avatar-${userId}-${Date.now()}.${ext}`);

  try {
    if (dest.exists) dest.delete();
    new File(srcUri).copy(dest);
  } catch (e) {
    Alert.alert("Couldn't set photo", e instanceof Error ? e.message : String(e));
    return;
  }

  deleteFileQuietly(prev);
  setAvatar(dest.uri);
}

export function removeAvatar(): void {
  const { avatarUri, setAvatar } = useSession.getState();
  deleteFileQuietly(avatarUri);
  setAvatar(null);
}
