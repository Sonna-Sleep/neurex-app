import type { NavigatorScreenParams } from '@react-navigation/native';

export type OnboardingStackParamList = {
  Welcome: undefined;
  Auth: undefined;
  EmailSent: { email: string };
  Pair: undefined;
  HowItWorks: undefined;
  NotificationsPermission: undefined;
};

export type TabParamList = {
  Home: undefined;
  History: undefined;
  Account: undefined;
};

export type RootStackParamList = {
  Onboarding: NavigatorScreenParams<OnboardingStackParamList>;
  Main: NavigatorScreenParams<TabParamList>;
};
