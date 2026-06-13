// Single chokepoint for the "a night finished processing" event, so every
// place that detects `status === 'ready'` produces the same side effects:
//   1. flag the night as unviewed → drives the "new" dot on the Journal tab
//   2. fire the local "Your night is ready" banner
//
// The local banner only reaches the user while the app's JS is alive
// (foreground / shortly after backgrounding under the BLE keep-alive). The
// overnight-closed-app case is covered by the backend push (Part C), which
// reuses the identical payload + data.sessionId so tap-routing is the same.
import { notifyProcessingComplete } from '../notifications/local';
import { useSession } from '../../state/session';
import type { Session } from '../repos/types';

// Guards against double-firing the OS banner if `handleNightReady` is called
// more than once for the same night (e.g. an immediate read + a realtime
// update both resolving). Process-lifetime only — that's all we need.
const notified = new Set<string>();

export function handleNightReady(session: Session): void {
  useSession.getState().markNightUnviewed(session.id);

  if (!notified.has(session.id)) {
    notified.add(session.id);
    notifyProcessingComplete(session.id).catch(() => undefined);
  }
}
