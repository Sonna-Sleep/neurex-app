/**
 * Cloud Lull session — the thin-client replacement for the on-device LullEngine.
 *
 * It does NO DSP. It taps the live BLE feed (engineTap), forwards each packet's
 * four decoded channels to the cloud over a WebSocket, and applies the volume /
 * mute commands the cloud sends back to the injected AudioSink. At the first
 * onset command it mutes and closes the socket; the night keeps recording via
 * the unchanged segment-upload path. Same start()/stop()/onTick shape as the old
 * LullEngine so WindDownScreen barely changes.
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

export interface CloudTick {
  tSec: number;
  W: number;
  volume: number;
  onset: boolean;
}

export interface CloudLullDeps {
  url?: string;
  makeSocket?: (url: string) => WebSocketLike;
}

export class CloudLullSession {
  private sock: LullSocket | null = null;
  private lastVolume = 1.0;
  private stopped = false;
  private muted = false;
  private elapsedMs = 0;
  private timeFloor = 1.0; // linear time fade, 1 → 0 over MAX_SESSION_MS
  private lastCmd: LullCmd | null = null;
  private rampTimer: ReturnType<typeof setInterval> | null = null;
  private readonly boundFeed: (s: EegSample[]) => void;

  constructor(
    private readonly fs: number,
    private readonly sessionId: string,
    private readonly sink: AudioSink,
    private readonly onTick?: (t: CloudTick) => void,
    private readonly onStatus?: (msg: string | null) => void,
    private readonly deps: CloudLullDeps = {},
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
        lastVolume: this.lastVolume,
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
      this.onStatus?.('25-minute limit reached — music muted.');
      void Promise.resolve(this.sink.mute()).catch(() => undefined);
      void this.stop();
    }
  }

  /** Drive the sink to the LOWER of the brain-driven volume and the time fade. */
  private applyVolume(): void {
    const v = Math.min(this.lastVolume, this.timeFloor);
    void Promise.resolve(this.sink.setVolume(v)).catch(() => undefined);
    const c = this.lastCmd;
    this.onTick?.({
      tSec: c ? c.tSec : this.elapsedMs / 1000,
      W: c ? c.W : 1,
      volume: v,
      onset: c ? c.onset : false,
    });
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
    this.lastVolume = c.volume; // brain-driven target; the time fade caps it further
    this.applyVolume();
    if (c.onset && !this.muted) {
      this.muted = true;
      void Promise.resolve(this.sink.mute()).catch(() => undefined);
      void this.stop();
    }
  }

  private hardMute(): void {
    // 10-minute offline cutoff: sound 100% off and end the session. The
    // recording keeps running via the segment path.
    if (this.muted) return;
    this.muted = true;
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
    return Promise.resolve(this.sink.stop()).catch(() => undefined);
  }
}
