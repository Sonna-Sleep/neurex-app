import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { deviceRepo } from '../lib/repos';
import { getSupabase } from '../lib/auth/supabase';

export type AuthStatus = 'unknown' | 'signed-out' | 'signed-in';

type User = {
  id: string;
  email: string | null;
  name: string | null;
  firstName?: string | null;
  dob?: string | null;            // ISO 'YYYY-MM-DD'
  sex?: 'male' | 'female' | 'unspecified' | null;
  // Account creation time from Supabase `auth.users.created_at`, surfaced as
  // "Member since" on the profile. Derived from auth — re-set on every sign-in.
  memberSinceMs?: number | null;
};

// Live recording state. Persists in-memory only — a stream resumes on a hot
// reload, not across a process kill. (Phase B's foreground service will
// re-create this from the native side after restoration.)
export type Streaming = {
  sessionId: string;
  startedAtMs: number;
  packets: number;
  samples: number;
  drops: number;
  lastSeq: number | null;
  generation: number;
  connection: 'connected' | 'reconnecting' | 'lost';
};

type SessionState = {
  authStatus: AuthStatus;
  user: User | null;
  // Local path to the user's chosen profile photo (copied into the app's
  // documentDirectory). Kept OUTSIDE `user` because setAuth rebuilds `user` on
  // every auth event and would otherwise wipe it. Device-local, persisted.
  avatarUri: string | null;
  pairedSerial: string | null;
  // Platform-stable BLE identifier (UUID on iOS, MAC on Android) returned by
  // ble-plx scan. We need this — not just the serial — to reconnect without
  // re-scanning. Persisted alongside pairedSerial.
  pairedDeviceId: string | null;
  onboardingComplete: boolean;
  hydrated: boolean;
  // True once the Supabase session check has completed — screens wait for
  // this before querying so they don't run as anonymous on a cold start.
  authReady: boolean;
  // Set right after a successful Modal upload, cleared when the resulting
  // session row is fetched (or the user dismisses). Drives the Home screen's
  // "Processing…" card. Transient — not persisted.
  processingSessionId: string | null;
  // Live stream state for the in-progress recording. null when idle. Transient.
  streaming: Streaming | null;
  // Live battery % from the paired sleep mask (notified via BLE Battery Service).
  // null while disconnected or before the first notify. Transient.
  deviceBattery: number | null;
  setAuth: (user: User | null) => void;
  patchUser: (patch: Partial<User>) => void;
  setAvatar: (uri: string | null) => void;
  setPaired: (serial: string | null, deviceId?: string | null) => void;
  completeOnboarding: () => void;
  signOut: () => void;
  setProcessingSessionId: (id: string | null) => void;
  setStreaming: (s: Streaming | null) => void;
  patchStreaming: (patch: Partial<Streaming>) => void;
  setDeviceBattery: (pct: number | null) => void;
};

export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      authStatus: 'unknown',
      user: null,
      avatarUri: null,
      pairedSerial: null,
      pairedDeviceId: null,
      onboardingComplete: false,
      hydrated: false,
      authReady: false,
      processingSessionId: null,
      streaming: null,
      deviceBattery: null,

      setAuth: (user) =>
        set(() => ({
          user,
          authStatus: user ? 'signed-in' : 'signed-out',
        })),

      patchUser: (patch) =>
        set((s) => (s.user ? { user: { ...s.user, ...patch } } : {})),

      setAvatar: (uri) => set({ avatarUri: uri }),

      setPaired: (serial, deviceId) => {
        if (serial) deviceRepo.pair(serial);
        set({
          pairedSerial: serial,
          // Only overwrite deviceId when caller passes one explicitly;
          // calling setPaired(null) clears both.
          ...(deviceId !== undefined || serial === null
            ? { pairedDeviceId: serial === null ? null : deviceId ?? null }
            : {}),
          // Forget last-known battery when unpairing so the StatusPill
          // doesn't keep showing a stale percent for a device that's gone.
          ...(serial === null ? { deviceBattery: null } : {}),
        });
      },

      completeOnboarding: () => set({ onboardingComplete: true }),

      signOut: () => {
        getSupabase()?.auth.signOut().catch(() => undefined);
        set({
          authStatus: 'signed-out',
          user: null,
          avatarUri: null,
          pairedSerial: null,
          pairedDeviceId: null,
          onboardingComplete: false,
          processingSessionId: null,
          streaming: null,
          deviceBattery: null,
        });
      },

      setProcessingSessionId: (id) => set({ processingSessionId: id }),

      setStreaming: (s) => set({ streaming: s }),

      patchStreaming: (patch) =>
        set((state) =>
          state.streaming ? { streaming: { ...state.streaming, ...patch } } : {},
        ),

      setDeviceBattery: (pct) => set({ deviceBattery: pct }),
    }),
    {
      name: 'neurex-session',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({
        user: s.user,
        avatarUri: s.avatarUri,
        pairedSerial: s.pairedSerial,
        pairedDeviceId: s.pairedDeviceId,
        onboardingComplete: s.onboardingComplete,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SessionState>;
        return {
          ...current,
          ...p,
          authStatus: p.user ? 'signed-in' : current.authStatus,
        };
      },
      onRehydrateStorage: () => (state) => {
        if (state?.pairedSerial) deviceRepo.pair(state.pairedSerial);
        useSession.setState({ hydrated: true });
      },
    },
  ),
);
