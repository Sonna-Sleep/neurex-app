// Tester-log sheet — the "RECORD the conditions" form for a diagnostic capture.
// Every diagnostic recording logs the conditions that produced it (electrode,
// mount, montage, reference, tester), pre-filled from the last run so the tester
// changes ONE variable per recording. Persisted to the diagnostics store; stamped
// onto the sessions row at finalize (see cloud/sessionMetadata).

import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { Segmented } from '../../../components/Segmented';
import { Eyebrow } from '../../../theme/typography';
import { colors, layout, spacing, systemFontFamily } from '../../../theme/tokens';
import type { TesterLog } from '../../../lib/cloud/sessionMetadata';
import { isTesterLogComplete } from '../../../lib/cloud/sessionMetadata';
import type { DiagnosticCaptureSetting } from '../../../state/diagnostics';
import { useDiagnostics } from '../../../state/diagnostics';

const CAPTURE_OPTIONS: { value: DiagnosticCaptureSetting; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' },
];

type FieldKey = keyof TesterLog;
const FIELDS: { key: FieldKey; label: string; placeholder: string; required: boolean }[] = [
  { key: 'electrodeType', label: 'electrode (material / version)', placeholder: 'dry Ag/AgCl v4', required: true },
  { key: 'electrodeBatch', label: 'electrode batch #', placeholder: 'b#12', required: true },
  { key: 'montage', label: 'montage (active site)', placeholder: 'Fpz-A1', required: true },
  { key: 'referenceSite', label: 'reference site', placeholder: 'ear / mastoid / A1', required: true },
  { key: 'biasSite', label: 'bias site (optional)', placeholder: 'forehead', required: false },
  { key: 'tester', label: 'tester', placeholder: 'who ran this', required: true },
  { key: 'notes', label: 'notes (optional)', placeholder: 'anything that happened', required: false },
];

export function TesterLogSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const lastTesterLog = useDiagnostics((s) => s.lastTesterLog);
  const diagnosticCapture = useDiagnostics((s) => s.diagnosticCapture);
  const setLastTesterLog = useDiagnostics((s) => s.setLastTesterLog);
  const setDiagnosticCapture = useDiagnostics((s) => s.setDiagnosticCapture);

  const [draft, setDraft] = useState<TesterLog>(lastTesterLog ?? {});

  // Re-seed from the last saved log each open (change-one-variable: keep the prior
  // run's values, edit the single thing that changed).
  useEffect(() => {
    if (visible) setDraft(lastTesterLog ?? {});
  }, [visible, lastTesterLog]);

  const set = (key: FieldKey, value: string) => setDraft((d) => ({ ...d, [key]: value }));

  const save = () => {
    // Trim everything; drop empty optionals so the store stays clean.
    const cleaned: TesterLog = {};
    for (const { key } of FIELDS) {
      const v = draft[key]?.trim();
      if (v) cleaned[key] = v;
    }
    setLastTesterLog(cleaned);
    onClose();
  };

  const complete = isTesterLogComplete(draft);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaProvider>
        <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
          <View style={styles.topBar}>
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={styles.close}>✕</Text>
            </Pressable>
            <Text style={styles.topTitle}>Recording conditions</Text>
            <Pressable onPress={save} hitSlop={12}>
              <Text style={styles.save}>Save</Text>
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={styles.scroll}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.field}>
              <Eyebrow>raw diagnostic capture</Eyebrow>
              <Segmented
                options={CAPTURE_OPTIONS}
                value={diagnosticCapture}
                onChange={setDiagnosticCapture}
              />
              <Text style={styles.hint}>
                Keeps the full all-channel raw signal so any night can be re-decoded
                later. Auto = on for internal builds, off for production.
              </Text>
            </View>

            {FIELDS.map(({ key, label, placeholder, required }) => (
              <View key={key} style={styles.field}>
                <Eyebrow>
                  {label}
                  {required ? ' *' : ''}
                </Eyebrow>
                <TextInput
                  style={styles.input}
                  value={draft[key] ?? ''}
                  onChangeText={(t) => set(key, t)}
                  placeholder={placeholder}
                  placeholderTextColor={colors.textTertiary}
                  multiline={key === 'notes'}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
            ))}

            <Text style={[styles.status, { color: complete ? colors.textSecondary : colors.warning }]}>
              {complete
                ? 'Complete — all required conditions logged.'
                : 'Incomplete — fill the required (*) fields before Start.'}
            </Text>
          </ScrollView>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary, paddingHorizontal: layout.screenPadding },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  close: { fontFamily: systemFontFamily, fontSize: 22, fontWeight: '500', color: colors.textSecondary },
  topTitle: { fontFamily: systemFontFamily, fontSize: 17, fontWeight: '600', color: colors.textPrimary },
  save: { fontFamily: systemFontFamily, fontSize: 16, fontWeight: '600', color: colors.textPrimary },
  scroll: { paddingTop: spacing.lg, paddingBottom: spacing.xxl },
  field: { gap: spacing.sm, marginBottom: spacing.xl },
  input: {
    color: colors.textPrimary,
    fontSize: 18,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderDivider,
  },
  hint: { fontFamily: systemFontFamily, fontSize: 13, color: colors.textTertiary, lineHeight: 18 },
  status: { fontFamily: systemFontFamily, fontSize: 14, fontWeight: '600', marginTop: spacing.sm },
});
