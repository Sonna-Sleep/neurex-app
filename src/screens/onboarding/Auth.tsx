import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as WebBrowser from 'expo-web-browser';

import { Button } from '../../components/Button';
import { GoogleLogo } from '../../components/GoogleLogo';
import { Logo } from '../../components/Logo';
import { SerifDisplay, Body, Eyebrow } from '../../theme/typography';
import { colors, fonts, layout, radii, spacing } from '../../theme/tokens';
import { useSession } from '../../state/session';
import { getSupabase, AUTH_REDIRECT_URL } from '../../lib/auth/supabase';
import type { OnboardingStackParamList } from '../../navigation/types';

WebBrowser.maybeCompleteAuthSession();

type Props = NativeStackScreenProps<OnboardingStackParamList, 'Auth'>;

export function Auth({ navigation }: Props) {
  const setAuth = useSession((s) => s.setAuth);
  const authStatus = useSession((s) => s.authStatus);
  const [email, setEmail] = useState('');
  const [busyMethod, setBusyMethod] = useState<'google' | 'email' | null>(null);
  const [showEmail, setShowEmail] = useState(false);
  const emailInputRef = useRef<TextInput>(null);
  const trimmedEmail = email.trim();
  const canSendEmail = trimmedEmail.length > 0;

  // When the user comes back from the email magic link, the auth listener
  // updates the session store. Navigate to the Profile step automatically.
  useEffect(() => {
    if (authStatus === 'signed-in') {
      navigation.navigate('Profile');
    }
  }, [authStatus, navigation]);

  const continueWithMockUser = (id: string, providedEmail: string | null) => {
    setAuth({ id, email: providedEmail, name: null });
    navigation.navigate('Profile');
  };

  const revealEmail = () => {
    setShowEmail(true);
    requestAnimationFrame(() => emailInputRef.current?.focus());
  };

  const handleGoogle = async () => {
    const supabase = getSupabase();
    if (!supabase) {
      continueWithMockUser('mock-google-user', null);
      return;
    }
    try {
      setBusyMethod('google');
      const redirectTo = AUTH_REDIRECT_URL;
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo,
          skipBrowserRedirect: true,
        },
      });
      if (error) throw error;
      if (!data?.url) throw new Error('No OAuth URL returned');

      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      if (result.type !== 'success' || !result.url) return;

      const params = new URL(result.url).hash
        .replace(/^#/, '')
        .split('&')
        .reduce<Record<string, string>>((acc, pair) => {
          const [k, v] = pair.split('=');
          if (k && v) acc[k] = decodeURIComponent(v);
          return acc;
        }, {});

      const accessToken = params.access_token;
      const refreshToken = params.refresh_token;
      if (!accessToken || !refreshToken) {
        throw new Error('Missing tokens from Google OAuth response');
      }

      const { data: sessionData, error: sessionErr } =
        await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
      if (sessionErr) throw sessionErr;

      const u = sessionData.user;
      if (u) {
        setAuth({ id: u.id, email: u.email ?? null, name: null });
        navigation.navigate('Profile');
      }
    } catch (e: any) {
      Alert.alert(
        "Couldn't sign in with Google",
        e?.message ?? 'Check your network and try again.',
      );
    } finally {
      setBusyMethod(null);
    }
  };

  const handleEmail = async () => {
    const trimmed = trimmedEmail;
    if (!trimmed) return;
    const supabase = getSupabase();
    if (!supabase) {
      continueWithMockUser('mock-email-user', trimmed);
      return;
    }
    try {
      setBusyMethod('email');
      const redirectTo = AUTH_REDIRECT_URL;
      const { error } = await supabase.auth.signInWithOtp({
        email: trimmed,
        options: {
          shouldCreateUser: true,
          emailRedirectTo: redirectTo,
        },
      });
      if (error) throw error;
      navigation.navigate('EmailSent', { email: trimmed });
    } catch (e: any) {
      Alert.alert(
        "Couldn't send the sign-in link",
        e?.message ?? 'Check your email address and try again.',
      );
    } finally {
      setBusyMethod(null);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.topBar}>
          <Pressable
            onPress={() => navigation.goBack()}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={12}
            style={({ pressed }) => [styles.backButton, pressed && styles.backPressed]}
          >
            <Text style={styles.backText}>Back</Text>
          </Pressable>
          <Logo height={26} />
          <View style={styles.topSpacer} />
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.center}>
            <View style={styles.copy}>
              <SerifDisplay style={styles.headline}>
                Create your account
              </SerifDisplay>
              <Body style={styles.subtext}>
                Save your nights and get your report when analysis finishes.
              </Body>
            </View>

            <View style={styles.actions}>
              <Button
                label="Continue with Google"
                variant="ghost"
                onPress={handleGoogle}
                loading={busyMethod === 'google'}
                disabled={busyMethod === 'email'}
                iconLeft={<GoogleLogo size={18} />}
              />

              <View style={styles.emailBlock}>
                <Button
                  label="Continue with Email"
                  variant={showEmail ? 'tonal' : 'ghost'}
                  onPress={revealEmail}
                  disabled={busyMethod === 'google'}
                />

                {showEmail ? (
                  <View style={styles.emailPanel}>
                    <Eyebrow style={styles.emailLabel}>Email</Eyebrow>
                    <TextInput
                      ref={emailInputRef}
                      value={email}
                      onChangeText={setEmail}
                      placeholder="you@neurex.tech"
                      placeholderTextColor={colors.textTertiary}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      autoCorrect={false}
                      autoComplete="email"
                      textContentType="emailAddress"
                      returnKeyType="send"
                      editable={busyMethod !== 'email'}
                      onSubmitEditing={() => {
                        if (canSendEmail) handleEmail();
                      }}
                      style={styles.input}
                    />
                    <Button
                      label="Send sign-in link"
                      onPress={handleEmail}
                      loading={busyMethod === 'email'}
                      disabled={!canSendEmail || busyMethod === 'google'}
                    />
                  </View>
                ) : null}
              </View>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
    paddingHorizontal: layout.screenPadding,
  },
  flex: { flex: 1 },
  topBar: {
    paddingTop: spacing.xl,
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: {
    width: 64,
    minHeight: 40,
    justifyContent: 'center',
  },
  backPressed: {
    opacity: 0.72,
  },
  backText: {
    color: colors.textSecondary,
    fontFamily: fonts.sans,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
  },
  topSpacer: {
    width: 64,
  },
  scroll: {
    flexGrow: 1,
    paddingBottom: spacing.xl,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'stretch',
    paddingBottom: spacing.xxxl,
  },
  copy: {
    gap: spacing.sm,
  },
  headline: {
    textAlign: 'left',
    maxWidth: 320,
    fontSize: 42,
    lineHeight: 48,
  },
  subtext: {
    maxWidth: 310,
    color: colors.textSecondary,
  },
  actions: {
    width: '100%',
    marginTop: spacing.xxl,
    gap: spacing.md,
  },
  emailBlock: {
    gap: spacing.md,
  },
  emailPanel: {
    gap: spacing.sm,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radii.card,
    backgroundColor: colors.bgSurface,
  },
  emailLabel: {
    color: colors.textSecondary,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.borderDivider,
    borderRadius: radii.button,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.textPrimary,
    fontFamily: fonts.sans,
    fontSize: 16,
    fontWeight: '400',
    backgroundColor: colors.bgElevated,
  },
});
