import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text } from 'react-native';

import { colors, systemFontFamily } from '../../theme/tokens';
import { useSession } from '../../state/session';
import {
  requestScheduledDeletion, deleteImmediately,
} from '../../lib/accountDeletion';

const GRACE_DAYS = 30;

export function DeleteAccountSection() {
  const signOut = useSession((s) => s.signOut);
  const streaming = useSession((s) => s.streaming);
  const [busy, setBusy] = useState(false);

  const onSchedule = async () => {
    setBusy(true);
    try {
      const { purgeAfterMs } = await requestScheduledDeletion();
      const date = new Date(purgeAfterMs).toLocaleDateString();
      setBusy(false);
      signOut();
      Alert.alert(
        'Deletion scheduled',
        `Your account and all data will be permanently deleted on ${date}. Log back in before then to cancel.`,
      );
    } catch (e) {
      setBusy(false);
      Alert.alert('Could not schedule deletion', e instanceof Error ? e.message : String(e));
    }
  };

  const onImmediate = async () => {
    setBusy(true);
    try {
      await deleteImmediately();
      setBusy(false);
      signOut();
      Alert.alert('Account deleted', 'Your account and all data have been permanently deleted.');
    } catch (e) {
      setBusy(false);
      Alert.alert('Could not delete account', e instanceof Error ? e.message : String(e));
    }
  };

  const confirm = () => {
    if (streaming) {
      Alert.alert('Recording in progress', 'Stop the recording before deleting your account.');
      return;
    }
    Alert.alert(
      'Delete account',
      `This permanently deletes your account and every sleep recording. This cannot be undone.\n\nSchedule deletion in ${GRACE_DAYS} days (cancel anytime by logging in), or delete immediately.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: `Schedule (${GRACE_DAYS} days)`, onPress: onSchedule },
        { text: 'Delete immediately', style: 'destructive', onPress: onImmediate },
      ],
    );
  };

  return (
    <Pressable onPress={confirm} disabled={busy} hitSlop={8}>
      <Text style={styles.delete}>{busy ? 'Working…' : 'Delete account'}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  delete: {
    fontFamily: systemFontFamily,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '500',
    color: colors.danger,
  },
});
