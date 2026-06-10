import { useEffect } from 'react';
import * as Linking from 'expo-linking';

import { getSupabase } from './supabase';
import { useSession } from '../../state/session';
import { cancelPendingDeletion } from '../accountDeletion';

function parseTokensFromUrl(url: string) {
  const hashIndex = url.indexOf('#');
  const queryIndex = url.indexOf('?');
  const fragment =
    hashIndex >= 0
      ? url.slice(hashIndex + 1)
      : queryIndex >= 0
        ? url.slice(queryIndex + 1)
        : '';
  if (!fragment) return null;

  const params = fragment.split('&').reduce<Record<string, string>>((acc, pair) => {
    const [k, v] = pair.split('=');
    if (k && v) acc[k] = decodeURIComponent(v);
    return acc;
  }, {});

  if (!params.access_token || !params.refresh_token) return null;
  return {
    access_token: params.access_token,
    refresh_token: params.refresh_token,
  };
}

function toUser(u: {
  id: string;
  email?: string | null;
  created_at?: string | null;
  user_metadata?: any;
}) {
  const m = u.user_metadata ?? {};
  return {
    id: u.id,
    email: u.email ?? null,
    name: null,
    firstName: m.first_name ?? null,
    dob: m.dob ?? null,
    sex: m.sex ?? null,
    memberSinceMs: u.created_at ? Date.parse(u.created_at) : null,
  };
}

/**
 * Wires Supabase auth state into the session store and handles the deep-link
 * return after an email magic-link or OAuth provider redirect.
 *
 * - When iOS opens the app via `neurex://auth-callback#access_token=...`, we
 *   parse the tokens and call `setSession`. Supabase fires `SIGNED_IN`.
 * - The auth state listener pushes the user into the zustand store, which
 *   navigates the user past the auth screen automatically.
 */
export function useAuthListener() {
  const setAuth = useSession((s) => s.setAuth);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) {
      // No backend configured — nothing to wait for.
      useSession.setState({ authReady: true });
      return;
    }

    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      const u = data.session?.user;
      if (u) setAuth(toUser(u));
      // Auth is now settled — screens can safely query Supabase.
      useSession.setState({ authReady: true });
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      const u = session?.user ?? null;
      if (u) {
        setAuth(toUser(u));
        // Logging back in within the grace window cancels a scheduled deletion.
        // Gate on SIGNED_IN: INITIAL_SESSION / TOKEN_REFRESHED must NOT cancel,
        // or a cold-start with a lingering session would silently revoke it.
        if (event === 'SIGNED_IN') {
          cancelPendingDeletion().catch(() => undefined);
        }
      } else setAuth(null);
    });

    const handleUrl = async (url: string) => {
      const tokens = parseTokensFromUrl(url);
      if (!tokens) return;
      await supabase.auth.setSession(tokens);
    };

    Linking.getInitialURL().then((url) => {
      if (url) handleUrl(url);
    });

    const linkSub = Linking.addEventListener('url', ({ url }) => {
      handleUrl(url);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
      linkSub.remove();
    };
  }, [setAuth]);
}
