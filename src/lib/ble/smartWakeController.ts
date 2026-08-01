import { useSession, type SmartWakeRuntime } from '../../state/session';
import { ImuMotionDetector, type LiveImuSample } from './imuLive';
import { LiveOrpProcessor, type OrpLiveSnapshot } from './orpLive';
import {
  encodeStartNow,
  smartWakeTimes,
  SUNRISE_COLOR,
  SUNRISE_MAX_BRIGHTNESS,
  SUNRISE_RAMP_S,
} from './smartAlarm';
import type { ConnectedDevice, ParsedPacket } from './types';

export const SMART_WAKE_CONFIDENCE_MIN = 0.6;
export const SMART_WAKE_MAX_ARTIFACT_BURDEN = 0.3;
export const SMART_WAKE_MIN_SLOPE_PER_MINUTE = 0.01;

function initialRuntime(sessionId: string, nowMs: number): SmartWakeRuntime | null {
  const alarm = useSession.getState().wakeAlarm;
  if (!alarm?.enabled) return null;
  const times = smartWakeTimes(nowMs, alarm);
  return {
    sessionId,
    state: 'idle',
    ...times,
    rawScore: null,
    smoothedScore: null,
    confidence: 0,
    artifactBurden: 1,
    slopePerMinute: null,
    imuMotionActive: false,
    ledStatus: 'arming',
    triggerReason: null,
    triggeredAtMs: null,
    updatedAtMs: nowMs,
  };
}

/** Owns the causal live scorer and the one-shot wake decision for one session.
 * Recording remains independent: every method is best-effort and errors are
 * contained here rather than escaping into the raw EEG callback.
 */
export class SmartWakeController {
  private device: ConnectedDevice;
  private readonly orp: LiveOrpProcessor;
  private readonly motion = new ImuMotionDetector();
  private triggering = false;

  constructor(readonly sessionId: string, device: ConnectedDevice, nowMs: number = Date.now()) {
    this.device = device;
    this.orp = new LiveOrpProcessor(device.scale.sampleRateHz);
    const persisted = useSession.getState().smartWakeRuntime;
    if (persisted?.sessionId !== sessionId) {
      useSession.getState().setSmartWakeRuntime(initialRuntime(sessionId, nowMs));
    }
    if (!device.alarmControlAvailable && this.runtime()) {
      this.patch({ ledStatus: 'unavailable', updatedAtMs: nowMs });
    }
  }

  setDevice(device: ConnectedDevice): void {
    this.device = device;
    const runtime = this.runtime();
    if (runtime && !runtime.triggeredAtMs) {
      this.patch({
        ledStatus: device.alarmControlAvailable ? 'arming' : 'unavailable',
        updatedAtMs: Date.now(),
      });
    }
    this.orp.resetPartial();
  }

  onAlarmChanged(nowMs: number = Date.now()): void {
    const previous = this.runtime();
    const next = initialRuntime(this.sessionId, nowMs);
    // A UI edit must not erase evidence that this session already started a ramp.
    if (previous?.triggeredAtMs) return;
    useSession.getState().setSmartWakeRuntime(next);
  }

  onPacket(packet: ParsedPacket, nowMs: number = Date.now()): void {
    try {
      const snapshots = this.orp.feedPacket(packet);
      for (const snapshot of snapshots) this.onSnapshot(snapshot, nowMs);
    } catch (error) {
      if (__DEV__) console.warn('[smart-wake] live ORP-like processing failed', error);
      this.orp.resetPartial();
    }
  }

  onDrop(): void {
    this.orp.resetPartial();
  }

  onImu(sample: LiveImuSample): void {
    try {
      this.motion.feed(sample);
    } catch (error) {
      if (__DEV__) console.warn('[smart-wake] live IMU decode failed', error);
    }
  }

  tick(nowMs: number = Date.now()): void {
    const runtime = this.runtime();
    if (!runtime || runtime.triggeredAtMs) return;
    if (nowMs >= runtime.fallbackDeadlineMs) {
      void this.triggerFallback(nowMs);
    } else if (nowMs >= runtime.wakeWindowStartMs && runtime.state === 'idle') {
      this.patch({ state: 'monitoring_pre_alarm', updatedAtMs: nowMs });
    }
  }

  markArmed(ok: boolean, nowMs: number = Date.now()): void {
    const runtime = this.runtime();
    if (!runtime || runtime.triggeredAtMs) return;
    this.patch({ ledStatus: ok ? 'armed' : 'error', updatedAtMs: nowMs });
  }

  fallbackDelaySeconds(nowMs: number = Date.now()): number | null {
    const runtime = this.runtime();
    if (!runtime || runtime.triggeredAtMs) return null;
    return Math.max(0, Math.round((runtime.fallbackDeadlineMs - nowMs) / 1000));
  }

  private onSnapshot(snapshot: OrpLiveSnapshot, nowMs: number): void {
    const runtime = this.runtime();
    if (!runtime) return;
    useSession.getState().appendSmartWakeHistory({
      atMs: nowMs,
      raw: snapshot.rawScore,
      smooth: snapshot.smoothedScore,
    });
    const motionActive = this.motion.isActive(nowMs);
    this.patch({
      rawScore: snapshot.rawScore,
      smoothedScore: snapshot.smoothedScore,
      confidence: snapshot.confidence,
      artifactBurden: snapshot.artifactBurden,
      slopePerMinute: snapshot.slopePerMinute,
      imuMotionActive: motionActive,
      state:
        runtime.state === 'idle' && nowMs >= runtime.wakeWindowStartMs
          ? 'monitoring_pre_alarm'
          : runtime.state,
      updatedAtMs: nowMs,
    });

    if (runtime.triggeredAtMs || nowMs < runtime.wakeWindowStartMs) return;
    if (nowMs >= runtime.fallbackDeadlineMs) {
      void this.triggerFallback(nowMs);
      return;
    }
    const naturalUptick =
      snapshot.rawScore !== null &&
      snapshot.smoothedScore !== null &&
      snapshot.baselineP60 !== null &&
      snapshot.smoothedScore > snapshot.baselineP60 &&
      snapshot.confidence >= SMART_WAKE_CONFIDENCE_MIN &&
      snapshot.artifactBurden < SMART_WAKE_MAX_ARTIFACT_BURDEN &&
      snapshot.slopePerMinute !== null &&
      snapshot.slopePerMinute >= SMART_WAKE_MIN_SLOPE_PER_MINUTE &&
      snapshot.sustainedSlopePerMinute !== null &&
      snapshot.sustainedSlopePerMinute > 0 &&
      !motionActive;
    if (naturalUptick) void this.triggerNatural(snapshot, nowMs);
  }

  private async triggerNatural(snapshot: OrpLiveSnapshot, nowMs: number): Promise<void> {
    if (this.triggering || this.runtime()?.triggeredAtMs) return;
    if (!this.device.alarmControlAvailable || !this.device.writeAlarmControl) {
      this.patch({ ledStatus: 'unavailable', updatedAtMs: nowMs });
      return;
    }
    this.triggering = true;
    try {
      await this.device.writeAlarmControl(
        encodeStartNow(SUNRISE_RAMP_S, SUNRISE_MAX_BRIGHTNESS, SUNRISE_COLOR),
      );
      this.patch({
        state: 'natural_ramping',
        triggerReason: 'natural_orp_uptick',
        triggeredAtMs: nowMs,
        rawScore: snapshot.rawScore,
        smoothedScore: snapshot.smoothedScore,
        confidence: snapshot.confidence,
        artifactBurden: snapshot.artifactBurden,
        slopePerMinute: snapshot.slopePerMinute,
        ledStatus: 'armed',
        updatedAtMs: nowMs,
      });
    } catch (error) {
      this.patch({ ledStatus: 'error', updatedAtMs: nowMs });
      if (__DEV__) console.warn('[smart-wake] natural ramp write failed', error);
    } finally {
      this.triggering = false;
    }
  }

  private async triggerFallback(nowMs: number): Promise<void> {
    if (this.triggering || this.runtime()?.triggeredAtMs) return;
    this.triggering = true;
    const runtime = this.runtime();
    try {
      // SET_ALARM_RELATIVE already makes this autonomous. If arming failed,
      // make one direct best-effort start while a connection still exists.
      if (
        runtime?.ledStatus !== 'armed' &&
        this.device.alarmControlAvailable &&
        this.device.writeAlarmControl
      ) {
        await this.device.writeAlarmControl(
          encodeStartNow(SUNRISE_RAMP_S, SUNRISE_MAX_BRIGHTNESS, SUNRISE_COLOR),
        );
      }
      this.patch({
        state: 'fallback_ramping',
        triggerReason: 'fallback_deadline',
        triggeredAtMs: nowMs,
        updatedAtMs: nowMs,
      });
    } catch (error) {
      // The board may be disconnected yet executing its autonomous command.
      // Record the deadline as the decision without pretending the write worked.
      this.patch({
        state: 'fallback_ramping',
        triggerReason: 'fallback_deadline',
        triggeredAtMs: nowMs,
        ledStatus: 'error',
        updatedAtMs: nowMs,
      });
      if (__DEV__) console.warn('[smart-wake] fallback direct write failed', error);
    } finally {
      this.triggering = false;
    }
  }

  private runtime(): SmartWakeRuntime | null {
    const runtime = useSession.getState().smartWakeRuntime;
    return runtime?.sessionId === this.sessionId ? runtime : null;
  }

  private patch(patch: Partial<SmartWakeRuntime>): void {
    if (this.runtime()) useSession.getState().patchSmartWakeRuntime(patch);
  }
}
