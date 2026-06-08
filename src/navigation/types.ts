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

export type HistoryStackParamList = {
  HistoryList: undefined;
  SessionDetail: { sessionId: string };
};

export type TabParamList = {
  Home: undefined;
  History: NavigatorScreenParams<HistoryStackParamList>;
  Account: undefined;
};

export type RootStackParamList = {
  Onboarding: NavigatorScreenParams<OnboardingStackParamList>;
  Main: NavigatorScreenParams<TabParamList>;
};
