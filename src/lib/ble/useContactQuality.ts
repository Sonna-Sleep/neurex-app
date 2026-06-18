// React hook exposing the live contact band + active flag to the UI (the ring).
// Backed by contactQualityService (fed by the recording stream and/or the preview).

import { useSyncExternalStore } from 'react';

import { type ContactState, getContactState, subscribeContact } from './contactQualityService';

export function useContactQuality(): ContactState {
  return useSyncExternalStore(subscribeContact, getContactState, getContactState);
}
