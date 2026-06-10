// Home screen card shown while a freshly-uploaded recording is being
// analyzed in the cloud. Replaces the EmptyState / Results render branch
// for the duration of the poll, then steps aside once the new session
// appears in Supabase (HomeScreen re-fetches and shows it as the latest).

import React, { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Card } from '../../../components/Card';
import { Body, Eyebrow, SerifHeadline } from '../../../theme/typography';
import { colors, spacing } from '../../../theme/tokens';
import { useProcessingStatus } from '../../../lib/upload/processingStatus';
import { handleNightReady } from '../../../lib/nights/onNightReady';
import { useSession } from '../../../state/session';

type Props = {
  sessionId: string;
  onReady: () => void;
};

export function ProcessingCard({ sessionId, onReady }: Props) {
  const status = useProcessingStatus(sessionId);
  const setProcessingSessionId = useSession((s) => s.setProcessingSessionId);

  useEffect(() => {
    if (status.state === 'ready') {
      handleNightReady(status.session);
      setProcessingSessionId(null);
      onReady();
    }
  }, [status, setProcessingSessionId, onReady]);

  return (
    <View style={styles.wrap}>
      <Eyebrow>last night</Eyebrow>
      <Card style={styles.card}>
        {status.state === 'error' ? (
          <ErrorBody message={status.error.message} />
        ) : (
          <ProcessingBody />
        )}
      </Card>
    </View>
  );
}

function ProcessingBody() {
  return (
    <View style={styles.row}>
      <ActivityIndicator color={colors.textSecondary} />
      <View style={styles.text}>
        <SerifHeadline>Analyzing your night</SerifHeadline>
        <Body style={styles.subtext}>
          This usually takes under a minute.
        </Body>
      </View>
    </View>
  );
}

function ErrorBody({ message }: { message: string }) {
  return (
    <View style={styles.text}>
      <SerifHeadline>We couldn’t finish processing</SerifHeadline>
      <Body style={styles.subtext}>{message}</Body>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingTop: spacing.md,
    gap: spacing.sm,
  },
  card: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  text: {
    flexShrink: 1,
    gap: spacing.xs,
  },
  subtext: {
    color: colors.textSecondary,
  },
});
