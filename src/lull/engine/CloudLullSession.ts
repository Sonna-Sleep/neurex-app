/**
 * Cloud Lull session — the thin-client replacement for the on-device LullEngine.
 *
 * It does NO DSP. It taps the live BLE feed (engineTap), forwards each packet's
 * four decoded channels to the cloud over a WebSocket, and applies the volume /
 * mute commands the cloud sends back to the injected AudioSink. At the first
 * onset command it mutes and closes the socket; the EEG/EOG recording/upload path
 * continues independently. The start()/stop()/onTick surface stays small so
 * WindDownScreen only coordinates session lifecycle.
 *
 * Two guarantees layered on top of the cloud commands:
 *   1. One-way volume ratchet — the speaker volume can ONLY ever go down. The
 *      applied volume is min(cloud target, 25-min time fade, lowest-ever-applied),
 *      so no command, reconnect, or W rebound can raise the sound back up.
 *   2. Session log — every applied tick (W, phase, cloud target, time fade, the
 *      volume that actually played, onset) is recorded and written to
 *      sessions/<id>/lull.json at close, so the wind-down is reviewable next to
 *      the EEG/EOG recording after the night uploads. The cloud keeps its own
 *      authoritative copy (lull_server.json) at the same storage prefix.
 */
import type { EegSample } from '../../lib/ble/types';
import type { AudioSink } from '../audio/AudioSink';
import { setLullFeed, clearLullFeed } from './engineTap';
import { LullSocket, type LullCmd, type WebSocketLike } from '../net/lullSocket';
import { LULL_WS_URL } from '../../lib/config';
import { getSupabase } from '../../lib/auth/supabase';

// Time fade: the volume ramps linearly to 0% over 25 minutes regardless of the
// brain signal, so the sound always winds down to silence by minute 25 even if
// sleep onset is never detected. Hardcoded.
const MAX_SESSION_MS = 25 * 60_000; // reach 0% volume at 25 minutes
const RAMP_INTERVAL_MS = 1000; // recompute the fade every second (smooth)
const LULL_LOG_NAME = 'lull.json';
const LULL_LOG_SCHEMA_VER = 1;

export interface CloudTick {
  tSec: number;
  W: number;
  volume: number;
  onset: boolean;
}

/** Why the wind-down ended — persisted in lull.json so a review knows how it closed. */
export type LullEndReason = 'onset' | 'time-cap' | 'offline' | 'stopped';

/** One recorded moment of the wind-down: what the cloud said + what actually played. */
export interface LullLogTick {
  /** ms since wind-down start (the app's own 1 Hz ramp clock). */
  tMs: number;
  /** Cloud session clock from the last cmd (tMs/1000 before the first cmd). */
  tSec: number;
  /** Sleepiness estimate W from the cloud (0..1). */
  W: number;
  /** calibrating | winddown | asleep. */
  phase: string;
  /** The cloud's target volume, BEFORE the time fade + ratchet. */
  brainVolume: number;
  /** The 25-minute linear time fade at this instant (1 → 0). */
  timeFloor: number;
  /** The APPLIED volume — what the speaker actually played (the ratcheted min). */
  volume: number;
  onset: boolean;
}

/** The persisted wind-down record (sessions/<id>/lull.json), uploaded as a sidecar. */
export interface LullSessionLog {
  schemaVer: number;
  sessionId: string;
  fs: number;
  reason: LullEndReason;
  /** ms-since-start when onset latched, or null if it never did. */
  onsetTMs: number | null;
  endedAtMs: number;
  ticks: LullLogTick[];
}

export interface CloudLullDeps {
  url?: string;
  makeSocket?: (url: string) => WebSocketLike;
  /** Override where the session log is written (default: sessions/<id>/lull.json).
   *  Injected in tests so persistence stays hermetic (no real filesystem). */
  persistLog?: (sessionId: string, log: LullSessionLog) => void;
}

/** Default log sink: write lull.json into the recording's session directory, so
 *  the existing finalize/sidecar path uploads it next to the EEG. expo-file-system
 *  is lazy-required (same pattern as streamController.ts) so this module loads in
 *  test/build environments that don't transform it — the write only runs on-device. */
function defaultPersistLullLog(sessionId: string, log: LullSessionLog): void {
  const { Directory, File, Paths } =
    require('expo-file-system') as typeof import('expo-file-system');
  const dir = new Directory(Paths.document, 'sessions', sessionId);
  if (!dir.exists) dir.create({ intermediates: true });
  const f = new File(dir, LULL_LOG_NAME);
  if (!f.exists) f.create();
  f.write(JSON.stringify(log));
}

export class CloudLullSession {
  private sock: LullSocket | null = null;
  private lastVolume = 1.0;
  private stopped = false;
  private muted = false;
  private elapsedMs = 0;
  private timeFloor = 1.0; // linear time fade, 1 → 0 over MAX_SESSION_MS
  // One-way ratchet: the lowest volume ever applied. The speaker is NEVER set
  // above this, so the sound can only ever go down — never back up.
  private volumeFloor = 1.0;
  private lastCmd: LullCmd | null = null;
  private rampTimer: ReturnType<typeof setInterval> | null = null;
  private readonly boundFeed: (s: EegSample[]) => void;
  private readonly ticks: LullLogTick[] = [];
  private endReason: LullEndReason = 'stopped';

  constructor(
    private readonly fs: number,
    private readonly sessionId: string,
    private readonly sink: AudioSink,
    private readonly onTick?: (t: CloudTick) => void,
    private readonly onStatus?: (msg: string | null) => void,
    private readonly deps: CloudLullDeps = {},
    /** {uid}/{label} storage prefix's LABEL part, so the cloud can co-locate its
     *  authoritative lull_server.json with this night. undefined → cloud skips it. */
    private readonly storageLabel?: string,
  ) {
    this.boundFeed = (s) => this.forward(s);
  }

  start(): void {
    if (this.stopped) return;
    if (this.sock) return;
    const url = this.deps.url ?? LULL_WS_URL;
    this.sock = new LullSocket(
      url,
      async () => ({
        token: await this.token(),
        fs: this.fs,
        sessionId: this.sessionId,
        // Send the ACTUAL current volume (the ratchet floor) so the cloud engine
        // resumes DOWNWARD from what's really playing after a reconnect, never up.
        lastVolume: this.volumeFloor,
        // Storage label so the cloud writes its authoritative copy alongside this
        // night's recording ({uid}/{label}/lull_server.json). Optional.
        label: this.storageLabel,
      }),
      {
        onReady: () => this.onStatus?.(null),
        onCmd: (c) => this.onCmd(c),
        onMute: () => this.hardMute(),
      },
      this.deps.makeSocket ? { factory: this.deps.makeSocket } : undefined,
    );
    this.sock.start();
    setLullFeed(this.boundFeed);
    // Start the time fade — volume ramps to 0% by 25 minutes.
    this.rampTimer = setInterval(() => this.rampTick(), RAMP_INTERVAL_MS);
  }

  private rampTick(): void {
    if (this.stopped || this.muted) return;
    this.elapsedMs += RAMP_INTERVAL_MS;
    this.timeFloor = Math.max(0, 1 - this.elapsedMs / MAX_SESSION_MS);
    this.applyVolume();
    if (this.elapsedMs >= MAX_SESSION_MS) {
      // Reached 0% at 25 minutes — silence and end the session.
      this.muted = true;
      this.endReason = 'time-cap';
      this.onStatus?.('25-minute limit reached — music muted.');
      void Promise.resolve(this.sink.mute()).catch(() => undefined);
      void this.stop();
    }
  }

  /** Drive the sink to the LOWER of the brain-driven volume, the time fade, and
   *  the ratchet floor — then record the applied tick. */
  private applyVolume(): void {
    const brain = this.lastVolume;
    const v = Math.min(brain, this.timeFloor, this.volumeFloor);
    this.volumeFloor = v; // ratchet: the applied volume never rises again
    void Promise.resolve(this.sink.setVolume(v)).catch(() => undefined);
    const c = this.lastCmd;
    const tSec = c ? c.tSec : this.elapsedMs / 1000;
    const W = c ? c.W : 1;
    const phase = c ? c.phase : 'calibrating';
    const onset = c ? c.onset : false;
    this.ticks.push({
      tMs: this.elapsedMs,
      tSec,
      W,
      phase,
      brainVolume: brain,
      timeFloor: this.timeFloor,
      volume: v,
      onset,
    });
    this.onTick?.({ tSec, W, volume: v, onset });
  }

  private async token(): Promise<string> {
    try {
      const c = getSupabase();
      const { data } = await c!.auth.getSession();
      return data.session?.access_token ?? '';
    } catch {
      return '';
    }
  }

  private forward(samples: EegSample[]): void {
    if (this.stopped || this.muted) return;
    const fp1: number[] = [];
    const fp2: number[] = [];
    const eogL: number[] = [];
    const eogR: number[] = [];
    let hasFp2 = false;
    let hasL = false;
    let hasR = false;
    for (const s of samples) {
      const ch = s.channels ?? {};
      fp1.push(ch['Fp1'] ?? s.fp1_uV);
      if (ch['Fp2'] !== undefined) { fp2.push(ch['Fp2']); hasFp2 = true; }
      if (ch['EOG-L'] !== undefined) { eogL.push(ch['EOG-L']); hasL = true; }
      if (ch['EOG-R'] !== undefined) { eogR.push(ch['EOG-R']); hasR = true; }
    }
    const frame: Record<string, unknown> = { type: 'samples', fp1 };
    if (hasFp2) frame.fp2 = fp2;
    if (hasL) frame.eogL = eogL;
    if (hasR) frame.eogR = eogR;
    this.sock?.send(frame);
  }

  private onCmd(c: LullCmd): void {
    if (this.stopped || this.muted) return;
    this.lastCmd = c;
    this.lastVolume = c.volume; // brain-driven target; the time fade + ratchet cap it further
    this.applyVolume();
    if (c.onset && !this.muted) {
      this.muted = true;
      this.endReason = 'onset';
      void Promise.resolve(this.sink.mute()).catch(() => undefined);
      void this.stop();
    }
  }

  private hardMute(): void {
    // 10-minute offline cutoff: sound 100% off and end the session. The
    // recording keeps running via the segment path.
    if (this.muted) return;
    this.muted = true;
    this.endReason = 'offline';
    this.onStatus?.('Lost connection to Lull — music muted.');
    void Promise.resolve(this.sink.mute()).catch(() => undefined);
    void this.stop();
  }

  stop(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    this.stopped = true;
    if (this.rampTimer) {
      clearInterval(this.rampTimer);
      this.rampTimer = null;
    }
    clearLullFeed(this.boundFeed);
    this.sock?.stop();
    this.sock = null;
    this.persistLog();
    return Promise.resolve(this.sink.stop()).catch(() => undefined);
  }

  /** Best-effort: write the wind-down log to sessions/<id>/lull.json so the
   *  finalize path uploads it as a sidecar. A lost log must never affect the
   *  recording, so every failure is swallowed. */
  private persistLog(): void {
    if (this.ticks.length === 0) return;
    if (!this.sessionId || this.sessionId === 'live') return;
    const onsetTick = this.ticks.find((t) => t.onset);
    const log: LullSessionLog = {
      schemaVer: LULL_LOG_SCHEMA_VER,
      sessionId: this.sessionId,
      fs: this.fs,
      reason: this.endReason,
      onsetTMs: onsetTick ? onsetTick.tMs : null,
      endedAtMs: this.elapsedMs,
      ticks: this.ticks,
    };
    try {
      (this.deps.persistLog ?? defaultPersistLullLog)(this.sessionId, log);
    } catch {
      /* best-effort — a missing lull.json never blocks the night */
    }
  }
}
