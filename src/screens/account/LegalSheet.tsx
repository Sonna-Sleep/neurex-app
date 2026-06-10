import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SerifHeadline, Eyebrow } from '../../theme/typography';
import { colors, layout, spacing, systemFontFamily } from '../../theme/tokens';
import { LEGAL_DOCS, type LegalDocKey } from '../../lib/legalContent';

// In-app legal/info reader. Renders the Privacy Policy / About content natively
// in a slide-up modal (matching EditProfileSheet) instead of opening the hosted
// page in an external browser. `doc === null` keeps it closed.
export function LegalSheet({ doc, onClose }: { doc: LegalDocKey | null; onClose: () => void }) {
  const content = doc ? LEGAL_DOCS[doc] : null;
  return (
    <Modal visible={doc !== null} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        {content ? (
          <>
            <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
              <SerifHeadline style={styles.title}>{content.title}</SerifHeadline>
              {content.updated ? <Text style={styles.updated}>{content.updated}</Text> : null}
              {content.intro ? <Text style={styles.body}>{content.intro}</Text> : null}
              {content.sections.map((s, i) => (
                <View key={i} style={styles.section}>
                  {s.heading ? <Eyebrow>{s.heading}</Eyebrow> : null}
                  <Text style={styles.body}>{s.body}</Text>
                </View>
              ))}
            </ScrollView>
            <Pressable onPress={onClose} hitSlop={8} style={styles.close}>
              <Text style={styles.closeText}>Close</Text>
            </Pressable>
          </>
        ) : null}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
    paddingHorizontal: layout.screenPadding,
  },
  scroll: {
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
  },
  title: {
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  updated: {
    fontFamily: systemFontFamily,
    fontSize: 13,
    color: colors.textTertiary,
    marginBottom: spacing.lg,
  },
  section: {
    marginTop: spacing.xl,
    gap: spacing.sm,
  },
  body: {
    fontFamily: systemFontFamily,
    fontSize: 15,
    lineHeight: 22,
    color: colors.textSecondary,
  },
  close: {
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  closeText: {
    fontFamily: systemFontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: colors.textSecondary,
  },
});
