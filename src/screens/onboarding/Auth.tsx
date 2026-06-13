import React, { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as WebBrowser from 'expo-web-browser';

import { Button } from '../../components/Button';
import { GoogleLogo } from '../../components/GoogleLogo';
import { SerifDisplay, Eyebrow } from '../../theme/typography';
import { colors, fonts, layout, radii, spacing } from '../../theme/tokens';
import { useSession } from '../../state/session';
import { getSupabase, AUTH_REDIRECT_URL } from '../../lib/auth/supabase';
import { ALLOW_DEV_BYPASS } from '../../lib/config';
import type { OnboardingStackParamList } from '../../navigation/types';

WebBrowser.maybeCompleteAuthSession();

type Props = NativeStackScreenProps<OnboardingStackParamList, 'Auth'>;

// Auth bypass for testing — reach the Pair/BLE flow without real auth.
// Shown in dev (__DEV__) AND in internal test builds where EXPO_PUBLIC_DEV_BYPASS=1.
// Hidden in normal production builds (flag unset) so it can't ship by accident.
const ALLOW_AUTH_BYPASS = ALLOW_DEV_BYPASS;

export function Auth({ navigation }: Props) {
  const setAuth = useSession((s) => s.setAuth);
  const authStatus = useSession((s) => s.authStatus);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [showEmail, setShowEmail] = useState(false);

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

  const handleGoogle = async () => {
    const supabase = getSupabase();
    if (!supabase) {
      continueWithMockUser('mock-google-user', null);
      return;
    }
    try {
      setBusy(true);
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
      setBusy(false);
    }
  };

  const handleEmail = async () => {
    const trimmed = email.trim();
    if (!trimmed) return;
    const supabase = getSupabase();
    if (!supabase) {
      continueWithMockUser('mock-email-user', trimmed);
      return;
    }
    try {
      setBusy(true);
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
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.center}>
          <SerifDisplay style={styles.headline}>
            Create your account
          </SerifDisplay>

          <View style={styles.actions}>
            <Button
              label="Continue with Google"
              variant="ghost"
              onPress={handleGoogle}
              loading={busy}
              iconLeft={<GoogleLogo size={18} />}
            />

            {showEmail ? (
              <View style={styles.emailRow}>
                <Eyebrow>email</Eyebrow>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@neurex.tech"
                  placeholderTextColor={colors.textTertiary}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={styles.input}
                />
                <Button
                  label="Send sign-in link"
                  onPress={handleEmail}
                  loading={busy}
                />
              </View>
            ) : (
              <Button
                label="Continue with email"
                variant="ghost"
                onPress={() => setShowEmail(true)}
              />
            )}

            {/* Auth bypass for testing — gated on ALLOW_AUTH_BYPASS so it only
                appears in dev or internal test builds, never in production. */}
            {ALLOW_AUTH_BYPASS ? (
              <Button
                label="Skip login (test)"
                variant="ghost"
                onPress={() => continueWithMockUser('dev-skip', null)}
              />
            ) : null}
          </View>
        </View>
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
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'stretch',
  },
  headline: {
    marginBottom: spacing.md,
    textAlign: 'left',
  },
  actions: {
    width: '100%',
    marginTop: spacing.xl,
    gap: spacing.md,
  },
  emailRow: {
    gap: spacing.sm,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radii.small,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.textPrimary,
    fontFamily: fonts.sans,
    fontSize: 16,
    fontWeight: '400',
    backgroundColor: colors.bgSurface,
  },
});
