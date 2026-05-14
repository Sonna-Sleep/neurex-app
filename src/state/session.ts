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
};

type SessionState = {
  authStatus: AuthStatus;
  user: User | null;
  pairedSerial: string | null;
  onboardingComplete: boolean;
  hydrated: boolean;
  setAuth: (user: User | null) => void;
  setPaired: (serial: string | null) => void;
  completeOnboarding: () => void;
  signOut: () => void;
};

export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      authStatus: 'unknown',
      user: null,
      pairedSerial: null,
      onboardingComplete: false,
      hydrated: false,

      setAuth: (user) =>
        set(() => ({
          user,
          authStatus: user ? 'signed-in' : 'signed-out',
        })),

      setPaired: (serial) => {
        if (serial) deviceRepo.pair(serial);
        set({ pairedSerial: serial });
      },

      completeOnboarding: () => set({ onboardingComplete: true }),

      signOut: () => {
        getSupabase()?.auth.signOut().catch(() => undefined);
        set({
          authStatus: 'signed-out',
          user: null,
          pairedSerial: null,
          onboardingComplete: false,
        });
      },
    }),
    {
      name: 'neurex-session',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({
        user: s.user,
        pairedSerial: s.pairedSerial,
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
