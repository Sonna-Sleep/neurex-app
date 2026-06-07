import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { Body, Eyebrow } from '../../theme/typography';
import { colors, spacing } from '../../theme/tokens';
import { useSession } from '../../state/session';
import {
  requestScheduledDeletion, deleteImmediately,
} from '../../lib/accountDeletion';

const GRACE_DAYS = 30;

export function DeleteAccountSection() {
  const signOut = useSession((s) => s.signOut);
  const [busy, setBusy] = useState(false);

  const onSchedule = async () => {
    setBusy(true);
    try {
      const { purgeAfterMs } = await requestScheduledDeletion();
      const date = new Date(purgeAfterMs).toLocaleDateString();
      Alert.alert(
        'Deletion scheduled',
        `Your account and all data will be permanently deleted on ${date}. Log back in before then to cancel.`,
        [{ text: 'OK', onPress: signOut }],
      );
    } catch (e) {
      Alert.alert('Could not schedule deletion', String(e));
    } finally {
      setBusy(false);
    }
  };

  const onImmediate = async () => {
    setBusy(true);
    try {
      await deleteImmediately();
      Alert.alert(
        'Account deleted',
        'Your account and all data have been permanently deleted.',
        [{ text: 'OK', onPress: signOut }],
      );
    } catch (e) {
      Alert.alert('Could not delete account', String(e));
    } finally {
      setBusy(false);
    }
  };

  const confirm = () => {
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
    <View style={styles.section}>
      <Eyebrow>danger zone</Eyebrow>
      <View style={styles.body}>
        <Pressable onPress={confirm} disabled={busy} hitSlop={8}>
          <Body style={styles.delete}>
            {busy ? 'working…' : 'delete account'}
          </Body>
        </Pressable>
      </View>
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
  body: { paddingTop: spacing.sm },
  delete: { color: colors.danger },
});
