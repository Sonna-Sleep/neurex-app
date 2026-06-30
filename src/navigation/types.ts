import type { NavigatorScreenParams } from '@react-navigation/native';

export type OnboardingStackParamList = {
  Welcome: undefined;
  Auth: undefined;
  EmailSent: { email: string };
  Profile: undefined;
  Pair: undefined;
  HowItWorks: undefined;
  NotificationsPermission: undefined;
};

export type JournalStackParamList = {
  JournalHome: undefined;
  JournalCalendar: undefined;
  SessionDetail: { sessionId: string };
};

export type TabParamList = {
  Sleep: undefined;
  Journal: NavigatorScreenParams<JournalStackParamList>;
  Profile: undefined;
};

export type RootStackParamList = {
  Onboarding: NavigatorScreenParams<OnboardingStackParamList>;
  Main: NavigatorScreenParams<TabParamList>;
  // Full-screen Lull wind-down modal (EEG-driven sleep soundscape fade).
  Lull: undefined;
};
