import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { deviceRepo } from '../lib/repos';
import { getSupabase } from '../lib/auth/supabase';
import { localWipe } from '../lib/accountDeletion';
import { clearActiveRecording } from '../lib/cloud/recovery';
import { clearPushTokenRegistration } from '../lib/push/registerPushToken';

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
  // Times the firmware clock reset mid-session (brownout/watchdog reboot); each
  // was a new epoch we kept recording across instead of dropping the rest of the
  // night. Surfaced for the UI / flaky-hardware debugging. undefined until first set.
  deviceReboots?: number;
  connection: 'connected' | 'reconnecting' | 'lost';
  // Set with a user-facing message on a FATAL, non-recoverable stream error
  // (e.g. storage full). The recording is stopped; whatever was written stays
  // on disk for upload. null in normal operation.
  error?: string | null;
};

// User's wake-up alarm for the mask's LED sunrise. Wall-clock time; the BLE
// arming math resolves it to "next occurrence" at arm time. Persisted so the
// alarm survives app restarts.
export type WakeAlarmSetting = { hour: number; minute: number; enabled: boolean };

function normalizeWakeAlarmSetting(value: unknown): WakeAlarmSetting | null {
  if (!value || typeof value !== 'object') return null;
  const alarm = value as Partial<WakeAlarmSetting>;
  const { hour, minute, enabled } = alarm;
  if (
    !Number.isInteger(hour) ||
    typeof hour !== 'number' ||
    hour < 0 ||
    hour > 23 ||
    !Number.isInteger(minute) ||
    typeof minute !== 'number' ||
    minute < 0 ||
    minute > 59 ||
    typeof enabled !== 'boolean'
  ) {
    return null;
  }
  return { hour, minute, enabled };
}

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
  // Live stream state for the in-progress recording. null when idle. Transient.
  streaming: Streaming | null;
  // Live battery % from the paired Neurex device (notified via BLE Battery Service).
  // null while disconnected or before the first notify. Transient.
  deviceBattery: number | null;
  // Session ids that became "ready" but the user hasn't opened yet. Drives the
  // "new" dot on the Journal tab. Persisted so the dot survives an app restart.
  unviewedNightIds: string[];
  wakeAlarm: WakeAlarmSetting | null;
  setAuth: (user: User | null) => void;
  patchUser: (patch: Partial<User>) => void;
  setAvatar: (uri: string | null) => void;
  markNightUnviewed: (id: string) => void;
  markNightViewed: (id: string) => void;
  setPaired: (serial: string | null, deviceId?: string | null) => void;
  completeOnboarding: () => void;
  signOut: () => void;
  setStreaming: (s: Streaming | null) => void;
  patchStreaming: (patch: Partial<Streaming>) => void;
  setDeviceBattery: (pct: number | null) => void;
  setWakeAlarm: (a: WakeAlarmSetting | null) => void;
};

export const useSession = create<SessionState>()(
  persist(
    (set, get) => ({
      authStatus: 'unknown',
      user: null,
      avatarUri: null,
      pairedSerial: null,
      pairedDeviceId: null,
      onboardingComplete: false,
      hydrated: false,
      authReady: false,
      streaming: null,
      deviceBattery: null,
      unviewedNightIds: [],
      wakeAlarm: null,

      setAuth: (user) =>
        set(() => ({
          user,
          authStatus: user ? 'signed-in' : 'signed-out',
        })),

      patchUser: (patch) =>
        set((s) => (s.user ? { user: { ...s.user, ...patch } } : {})),

      setAvatar: (uri) => set({ avatarUri: uri }),

      markNightUnviewed: (id) =>
        set((s) =>
          s.unviewedNightIds.includes(id)
            ? {}
            : { unviewedNightIds: [...s.unviewedNightIds, id] },
        ),

      markNightViewed: (id) =>
        set((s) =>
          s.unviewedNightIds.includes(id)
            ? { unviewedNightIds: s.unviewedNightIds.filter((x) => x !== id) }
            : {},
        ),

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
        if (get().streaming !== null) {
          set((s) =>
            s.streaming
              ? {
                  streaming: {
                    ...s.streaming,
                    error: 'Stop recording before logging out.',
                  },
                }
              : {},
          );
          return;
        }
        // Push cleanup must run while the session is still active (RLS requires auth),
        // then chain the actual Supabase sign-out after it resolves.
        const supabase = getSupabase();
        void (async () => {
          await clearPushTokenRegistration();
          await supabase?.auth.signOut();
        })().catch(() => undefined);
        set({
          authStatus: 'signed-out',
          user: null,
          avatarUri: null,
          pairedSerial: null,
          pairedDeviceId: null,
          onboardingComplete: false,
          streaming: null,
          deviceBattery: null,
          unviewedNightIds: [],
          wakeAlarm: null,
        });
        void Promise.all([localWipe(), clearActiveRecording()]);
      },

      setStreaming: (s) => set({ streaming: s }),

      patchStreaming: (patch) =>
        set((state) =>
          state.streaming ? { streaming: { ...state.streaming, ...patch } } : {},
        ),

      setDeviceBattery: (pct) => set({ deviceBattery: pct }),

      setWakeAlarm: (a) => set({ wakeAlarm: a }),
    }),
    {
      name: 'neurex-session',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({
        user: s.user,
        avatarUri: s.avatarUri,
        unviewedNightIds: s.unviewedNightIds,
        pairedSerial: s.pairedSerial,
        pairedDeviceId: s.pairedDeviceId,
        onboardingComplete: s.onboardingComplete,
        wakeAlarm: s.wakeAlarm,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SessionState>;
        return {
          ...current,
          ...p,
          authStatus: p.user ? 'signed-in' : current.authStatus,
          wakeAlarm: normalizeWakeAlarmSetting(p.wakeAlarm),
        };
      },
      onRehydrateStorage: () => (state) => {
        if (state?.pairedSerial) deviceRepo.pair(state.pairedSerial);
        useSession.setState({ hydrated: true });
      },
    },
  ),
);
