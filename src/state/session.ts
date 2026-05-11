import { create } from 'zustand';
import { deviceRepo } from '../lib/repos';

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
  setAuth: (user: User | null) => void;
  setPaired: (serial: string | null) => void;
  completeOnboarding: () => void;
  signOut: () => void;
};

export const useSession = create<SessionState>((set) => ({
  authStatus: 'unknown',
  user: null,
  pairedSerial: null,
  onboardingComplete: false,

  setAuth: (user) =>
    set(() => ({
      user,
      authStatus: user ? 'signed-in' : 'signed-out',
    })),

  setPaired: (serial) => {
    if (serial) deviceRepo.setPaired(serial);
    set({ pairedSerial: serial });
  },

  completeOnboarding: () => set({ onboardingComplete: true }),

  signOut: () =>
    set({
      authStatus: 'signed-out',
      user: null,
      pairedSerial: null,
      onboardingComplete: false,
    }),
}));
