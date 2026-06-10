import React, { useEffect, useState } from 'react';
import {
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { Eyebrow } from '../../theme/typography';
import { colors, layout, spacing, systemFontFamily } from '../../theme/tokens';
import { useSession } from '../../state/session';
import { validateSupport } from '../../lib/support/validateSupport';
import { sendSupportMessage } from '../../lib/support/sendSupportMessage';

// In-app Contact support. Mirrors EditProfileSheet: slide-up modal, ✕/title/Send
// top bar, underlined fields. Email pre-fills from the account but stays
// editable (people often want replies somewhere else); the message goes to the
// support_messages table, so no mail app is ever needed — though a mailto
// fallback link stays at the bottom for anyone who prefers email.
export function SupportSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const accountEmail = useSession((s) => s.user?.email);
  const [email, setEmail] = useState(accountEmail ?? '');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  // The Modal stays mounted (visibility via `visible`), so initializers run only
  // once. Re-seed each open so an abandoned draft or a previous "sent" state
  // doesn't leak into the next visit.
  useEffect(() => {
    if (!visible) return;
    setEmail(accountEmail ?? '');
    setMessage('');
    setError(null);
    setSent(false);
  }, [visible, accountEmail]);

  const send = async () => {
    if (busy) return;
    const input = validateSupport(email, message);
    if (!input.ok) {
      setError(input.error);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await sendSupportMessage(input.email, input.message);
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      {/* A RN Modal renders outside the app's SafeAreaProvider, so SafeAreaView
          insets would be 0 (content slides under the status bar). Give the modal
          its own provider so the top inset is real. */}
      <SafeAreaProvider>
        <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
          <View style={styles.topBar}>
            <Pressable onPress={onClose} hitSlop={12} disabled={busy}>
              <Text style={styles.close}>✕</Text>
            </Pressable>
            <Text style={styles.topTitle}>Contact support</Text>
            {sent ? (
              <View style={styles.sendSpacer} />
            ) : (
              <Pressable onPress={send} hitSlop={12} disabled={busy}>
                <Text style={[styles.send, busy && styles.sendDisabled]}>
                  {busy ? 'Sending…' : 'Send'}
                </Text>
              </Pressable>
            )}
          </View>

          {sent ? (
            <View style={styles.sentBlock}>
              <Text style={styles.sentTitle}>Message sent</Text>
              <Text style={styles.sentBody}>
                Thanks for reaching out — we’ll reply to {email.trim()}.
              </Text>
              <Pressable onPress={onClose} hitSlop={8} style={styles.doneBtn}>
                <Text style={styles.doneText}>Done</Text>
              </Pressable>
            </View>
          ) : (
            <ScrollView
              contentContainerStyle={styles.scroll}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.field}>
                <Eyebrow>your email</Eyebrow>
                <TextInput
                  style={styles.input}
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@example.com"
                  placeholderTextColor={colors.textTertiary}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!busy}
                />
              </View>

              <View style={styles.field}>
                <Eyebrow>how can we help?</Eyebrow>
                <TextInput
                  style={[styles.input, styles.messageInput]}
                  value={message}
                  onChangeText={setMessage}
                  placeholder="Tell us what's going on — the more detail, the faster we can help."
                  placeholderTextColor={colors.textTertiary}
                  multiline
                  textAlignVertical="top"
                  editable={!busy}
                />
              </View>

              {error ? <Text style={styles.error}>{error}</Text> : null}

              <Pressable
                onPress={() => Linking.openURL('mailto:contact@neurex.tech')}
                hitSlop={8}
                style={styles.mailFallback}
              >
                <Text style={styles.mailFallbackText}>Prefer email? contact@neurex.tech</Text>
              </Pressable>
            </ScrollView>
          )}
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
    paddingHorizontal: layout.screenPadding,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  close: {
    fontFamily: systemFontFamily,
    fontSize: 22,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  topTitle: {
    fontFamily: systemFontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  send: {
    fontFamily: systemFontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: colors.accent,
  },
  sendDisabled: {
    color: colors.textTertiary,
  },
  // Keeps the title centered when the Send action is hidden (sent state).
  sendSpacer: {
    width: 44,
  },
  scroll: {
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  field: {
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  input: {
    fontFamily: systemFontFamily,
    color: colors.textPrimary,
    fontSize: 16,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderDivider,
  },
  messageInput: {
    minHeight: 140,
    lineHeight: 22,
  },
  error: {
    fontFamily: systemFontFamily,
    fontSize: 13,
    color: colors.warning,
    marginBottom: spacing.lg,
  },
  mailFallback: {
    marginTop: spacing.md,
  },
  mailFallbackText: {
    fontFamily: systemFontFamily,
    fontSize: 13,
    color: colors.textTertiary,
  },
  sentBlock: {
    paddingTop: spacing.xxl,
    gap: spacing.sm,
    alignItems: 'flex-start',
  },
  sentTitle: {
    fontFamily: systemFontFamily,
    fontSize: 22,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  sentBody: {
    fontFamily: systemFontFamily,
    fontSize: 15,
    lineHeight: 22,
    color: colors.textSecondary,
  },
  doneBtn: {
    marginTop: spacing.xl,
  },
  doneText: {
    fontFamily: systemFontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: colors.accent,
  },
});
