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
    this.lastVolume = c.volume;
    void Promise.resolve(this.sink.setVolume(c.volume)).catch(() => undefined);
    this.onTick?.({ tSec: c.tSec, W: c.W, volume: c.volume, onset: c.onset });
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
    clearLullFeed(this.boundFeed);
    this.sock?.stop();
    this.sock = null;
    return Promise.resolve(this.sink.stop()).catch(() => undefined);
  }
}
