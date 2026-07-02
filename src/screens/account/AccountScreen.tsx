import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import * as Sharing from 'expo-sharing';

import { colors, layout, radii, spacing, systemFontFamily } from '../../theme/tokens';
import { Avatar } from '../../components/Avatar';
import { useSession } from '../../state/session';
import { ageFromDob } from '../../lib/profile';
import { sessionRepo, type Session } from '../../lib/repos';
import { transmitSession } from '../../lib/cloud/cloudSync';
import { inspectLocalRecordings, type LocalRecordingInspection } from '../../lib/cloud/recovery';
import { exportRecordingBundle } from '../../lib/files/recordingBundleExport';
import type { LegalDocKey } from '../../lib/legalContent';
import appConfig from '../../../app.json';
import { DeleteAccountSection } from './DeleteAccountSection';
import { EditProfileSheet } from './EditProfileSheet';
import { LegalSheet } from './LegalSheet';
import { SupportSheet } from './SupportSheet';
import { TAB_BAR_SPACE } from '../../navigation/FloatingTabBar';

function memberSinceLabel(ms: number | null | undefined): string | null {
  if (!ms) return null;
  return `Member since ${new Date(ms).toLocaleDateString(undefined, {
    month: 'short',
    year: 'numeric',
  })}`;
}

function fmtDur(min: number | null): string {
  if (min == null) return '—';
  const rounded = Math.round(min);
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function fmtDurationMs(ms: number): string {
  const totalMin = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtStarted(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function profileStats(sessions: Session[]) {
  const completed = sessions.filter((s) => s.score != null && s.tst != null);
  if (completed.length === 0) {
    return { nights: '—', avgAsleep: '—', avgScore: '—' };
  }
  const avgTst = completed.reduce((sum, s) => sum + (s.tst ?? 0), 0) / completed.length;
  const avgScore = completed.reduce((sum, s) => sum + (s.score ?? 0), 0) / completed.length;
  return {
    nights: `${completed.length}`,
    avgAsleep: fmtDur(avgTst),
    avgScore: `${Math.round(avgScore)}%`,
  };
}

export function AccountScreen() {
  const user = useSession((s) => s.user);
  const avatarUri = useSession((s) => s.avatarUri);
  const signOut = useSession((s) => s.signOut);
  const streaming = useSession((s) => s.streaming);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [editing, setEditing] = useState(false);
  const [legalDoc, setLegalDoc] = useState<LegalDocKey | null>(null);
  const [support, setSupport] = useState(false);
  const [localRecordings, setLocalRecordings] = useState<LocalRecordingInspection[]>([]);
  const [localBusy, setLocalBusy] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const loadStats = useCallback(async () => {
    try {
      setSessions(await sessionRepo.list());
    } catch {
      setSessions([]);
    }
  }, []);

  const loadLocalRecordings = useCallback(() => {
    setLocalRecordings(inspectLocalRecordings(streaming?.sessionId ?? null));
  }, [streaming?.sessionId]);

  useFocusEffect(
    useCallback(() => {
      void loadStats();
      loadLocalRecordings();
    }, [loadStats, loadLocalRecordings]),
  );

  const firstName = user?.firstName?.trim();
  const name = firstName || 'You';
  const age = ageFromDob(user?.dob);
  const sub = [age ? `${age}` : null, user?.sex && user.sex !== 'unspecified' ? user.sex : null]
    .filter(Boolean)
    .join(' · ');
  const memberSince = memberSinceLabel(user?.memberSinceMs);
  const profileMeta = [sub || null, memberSince].filter(Boolean).join(' · ');
  const stats = useMemo(() => profileStats(sessions), [sessions]);
  const onSignOut = useCallback(() => {
    if (streaming) {
      Alert.alert('Recording in progress', 'Stop the recording before logging out.');
      return;
    }
    signOut();
  }, [signOut, streaming]);

  const onExportLocal = useCallback(
    async (recording: LocalRecordingInspection) => {
      const key = `export:${recording.sessionId}`;
      setLocalBusy(key);
      setLocalError(null);
      try {
        if (!(await Sharing.isAvailableAsync())) {
          throw new Error('Sharing is not available on this device.');
        }
        const bundle = await exportRecordingBundle(recording.sessionId);
        await Sharing.shareAsync(bundle.uri, {
          mimeType: 'application/zip',
          UTI: 'com.pkware.zip-archive',
          dialogTitle: 'Export recording bundle',
        });
        loadLocalRecordings();
      } catch (e) {
        setLocalError((e as Error).message);
      } finally {
        setLocalBusy(null);
      }
    },
    [loadLocalRecordings],
  );

  const onRetryLocal = useCallback(
    async (recording: LocalRecordingInspection) => {
      if (!recording.stageable) {
        Alert.alert('Recording is short', 'Export is available, but cloud analysis starts at 10 minutes.');
        return;
      }
      const key = `sync:${recording.sessionId}`;
      setLocalBusy(key);
      setLocalError(null);
      try {
        await transmitSession({
          sessionId: recording.sessionId,
          startMs: recording.startedAtMs,
          endMs: recording.endMs,
        });
        loadLocalRecordings();
        await loadStats();
      } catch (e) {
        setLocalError((e as Error).message);
      } finally {
        setLocalBusy(null);
      }
    },
    [loadLocalRecordings, loadStats],
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.profileHeader}>
          <View style={styles.identityRow}>
            <Avatar uri={avatarUri} name={name} size={64} />
            <View style={styles.identityText}>
              <Text style={styles.name} numberOfLines={1}>
                {name}
              </Text>
              {user?.email ? (
                <Text style={styles.sub} numberOfLines={1}>
                  {user.email}
                </Text>
              ) : null}
            </View>
            <Pressable onPress={() => setEditing(true)} hitSlop={8} style={styles.editBtn}>
              <Text style={styles.editText}>Edit profile</Text>
            </Pressable>
          </View>
          {profileMeta ? (
            <Text style={styles.meta} numberOfLines={1}>
              {profileMeta}
            </Text>
          ) : null}
        </View>

        <View style={styles.statsPanel}>
          <ProfileStat value={stats.nights} label="Nights" first />
          <ProfileStat value={stats.avgAsleep} label="Avg. asleep" />
          <ProfileStat value={stats.avgScore} label="Avg. score" />
        </View>

        {localRecordings.length > 0 ? (
          <SavedRecordingsPanel
            recordings={localRecordings}
            busyKey={localBusy}
            error={localError}
            onRetry={onRetryLocal}
            onExport={onExportLocal}
          />
        ) : null}

        <View style={styles.card}>
          <Row label="Contact support" onPress={() => setSupport(true)} first />
          <Row label="Privacy policy" onPress={() => setLegalDoc('privacy')} />
          <Row label="About" onPress={() => setLegalDoc('about')} />
        </View>

        <View style={styles.accountCard}>
          <Pressable onPress={onSignOut} hitSlop={8} style={styles.accountRow}>
            <Text style={styles.logout}>Log out</Text>
          </Pressable>
          <View style={[styles.accountRow, styles.accountDivider]}>
            <DeleteAccountSection />
          </View>
        </View>

        <View style={styles.footer}>
          <Text style={styles.version}>version {appConfig.expo.version}</Text>
        </View>
      </ScrollView>

      <EditProfileSheet visible={editing} onClose={() => setEditing(false)} />
      <LegalSheet doc={legalDoc} onClose={() => setLegalDoc(null)} />
      <SupportSheet visible={support} onClose={() => setSupport(false)} />
    </SafeAreaView>
  );
}

function ProfileStat({ value, label, first }: { value: string; label: string; first?: boolean }) {
  return (
    <View style={[styles.statItem, !first && styles.statDivider]}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78}>
        {value}
      </Text>
    </View>
  );
}

function Row({ label, onPress, first }: { label: string; onPress: () => void; first?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, !first && styles.rowDivider, pressed && styles.rowPressed]}
    >
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

function SavedRecordingsPanel({
  recordings,
  busyKey,
  error,
  onRetry,
  onExport,
}: {
  recordings: LocalRecordingInspection[];
  busyKey: string | null;
  error: string | null;
  onRetry: (recording: LocalRecordingInspection) => void;
  onExport: (recording: LocalRecordingInspection) => void;
}) {
  return (
    <View style={styles.localPanel}>
      <View style={styles.localHeader}>
        <Text style={styles.localTitle}>Saved recordings</Text>
        <Text style={styles.localCount}>{recordings.length}</Text>
      </View>
      {error ? <Text style={styles.localError}>{error}</Text> : null}
      {recordings.map((recording, index) => {
        const syncKey = `sync:${recording.sessionId}`;
        const exportKey = `export:${recording.sessionId}`;
        const busy = busyKey === syncKey || busyKey === exportKey;
        const flags = [
          recording.hasScale ? 'scale' : null,
          recording.hasManifest ? 'manifest' : null,
          recording.hasStreamStats ? 'stats' : null,
          recording.hasImu ? 'IMU' : null,
        ].filter(Boolean);
        return (
          <View key={recording.sessionId} style={[styles.localItem, index > 0 && styles.localDivider]}>
            <View style={styles.localItemTop}>
              <View style={styles.localItemText}>
                <Text style={styles.localName} numberOfLines={1}>
                  {fmtStarted(recording.startedAtMs)}
                </Text>
                <Text style={styles.localMeta} numberOfLines={2}>
                  {fmtDurationMs(recording.durationMs)} · {fmtBytes(recording.sizeBytes)}
                  {flags.length ? ` · ${flags.join(', ')}` : ''}
                </Text>
              </View>
              <Text style={[styles.localStatus, !recording.stageable && styles.localStatusMuted]}>
                {recording.stageable ? 'Ready' : 'Short'}
              </Text>
            </View>
            <View style={styles.localActions}>
              <SmallAction
                label={busyKey === syncKey ? 'Syncing' : 'Retry'}
                disabled={busy}
                onPress={() => onRetry(recording)}
              />
              <SmallAction
                label={busyKey === exportKey ? 'Exporting' : 'Export'}
                disabled={busy}
                onPress={() => onExport(recording)}
              />
            </View>
          </View>
        );
      })}
    </View>
  );
}

function SmallAction({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.smallAction,
        pressed && !disabled && styles.rowPressed,
        disabled && styles.disabled,
      ]}
    >
      <Text style={styles.smallActionText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
    paddingHorizontal: layout.screenPadding,
  },
  scroll: {
    paddingTop: spacing.xl,
    paddingBottom: TAB_BAR_SPACE + spacing.xxl,
    gap: spacing.lg,
  },
  profileHeader: {
    gap: spacing.md,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  identityText: {
    flex: 1,
    gap: spacing.xs,
    minWidth: 0,
  },
  name: {
    fontFamily: systemFontFamily,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '600',
    letterSpacing: -0.3,
    color: colors.textPrimary,
  },
  sub: {
    fontFamily: systemFontFamily,
    fontSize: 15,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  meta: {
    fontFamily: systemFontFamily,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textTertiary,
  },
  editBtn: {
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  editText: {
    fontFamily: systemFontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  statsPanel: {
    flexDirection: 'row',
    backgroundColor: colors.bgSurface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    overflow: 'hidden',
  },
  statItem: {
    flex: 1,
    minHeight: 82,
    justifyContent: 'space-between',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  statDivider: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: colors.borderSubtle,
  },
  statValue: {
    fontFamily: systemFontFamily,
    fontSize: 22,
    lineHeight: 27,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  statLabel: {
    fontFamily: systemFontFamily,
    fontSize: 12,
    lineHeight: 16,
    color: colors.textSecondary,
  },
  card: {
    backgroundColor: colors.bgSurface,
    borderRadius: radii.card,
    paddingHorizontal: spacing.md,
  },
  localPanel: {
    backgroundColor: colors.bgSurface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  localHeader: {
    minHeight: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  localTitle: {
    fontFamily: systemFontFamily,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  localCount: {
    fontFamily: systemFontFamily,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textTertiary,
  },
  localError: {
    fontFamily: systemFontFamily,
    fontSize: 13,
    lineHeight: 18,
    color: colors.warning,
  },
  localItem: {
    gap: spacing.sm,
    paddingTop: spacing.sm,
  },
  localDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
    marginTop: spacing.xs,
  },
  localItemTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  localItemText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  localName: {
    fontFamily: systemFontFamily,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  localMeta: {
    fontFamily: systemFontFamily,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textSecondary,
  },
  localStatus: {
    fontFamily: systemFontFamily,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
    color: colors.positive,
  },
  localStatusMuted: {
    color: colors.textTertiary,
  },
  localActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  smallAction: {
    minHeight: 36,
    minWidth: 92,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.small,
    borderWidth: 1,
    borderColor: colors.borderDivider,
    paddingHorizontal: spacing.md,
  },
  smallActionText: {
    fontFamily: systemFontFamily,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  disabled: {
    opacity: 0.45,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 54,
    paddingVertical: 14,
  },
  rowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
  },
  rowPressed: {
    opacity: 0.5,
  },
  rowLabel: {
    fontFamily: systemFontFamily,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  chevron: {
    fontFamily: systemFontFamily,
    fontSize: 20,
    color: colors.textTertiary,
  },
  accountCard: {
    backgroundColor: colors.bgSurface,
    borderRadius: radii.card,
    paddingHorizontal: spacing.md,
    marginTop: spacing.md,
  },
  accountRow: {
    minHeight: 54,
    justifyContent: 'center',
    paddingVertical: 14,
  },
  accountDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
  },
  logout: {
    fontFamily: systemFontFamily,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  footer: {
    alignItems: 'flex-start',
    paddingTop: spacing.xs,
  },
  version: {
    fontFamily: systemFontFamily,
    fontSize: 12,
    color: colors.textTertiary,
  },
});
