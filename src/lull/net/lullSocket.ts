/**
 * Thin WebSocket transport for the cloud Lull loop. No DSP — it opens the
 * socket, performs the hello/ready handshake, forwards `samples` frames, and
 * surfaces `cmd` frames. It owns reconnect (capped backoff) and the agreed
 * 10-minute hard cutoff: if the cloud stays unreachable for 10 continuous
 * minutes, it fires `onMute` (caller turns the sound 100% off) and gives up.
 *
 * The socket constructor and timers are injectable so this is unit-testable with
 * fake timers and a mock socket — no real network in tests.
 */

export interface LullCmd {
  tSec: number;
  W: number;
  volume: number;
  phase: string;
  onset: boolean;
}

export interface LullHello {
  token: string;
  fs: number;
  sessionId: string;
  lastVolume: number;
}

export interface LullSocketHandlers {
  onReady: () => void;
  onCmd: (cmd: LullCmd) => void;
  /** The 10-minute cutoff fired: caller should mute 100% and end the session. */
  onMute: () => void;
}

/** The slice of the WebSocket API this wrapper uses (injectable for tests). */
export interface WebSocketLike {
  send(data: string): void;
  close(code?: number): void;
  onopen: ((ev?: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number }) => void) | null;
  onerror: ((ev?: unknown) => void) | null;
}

export interface LullSocketOpts {
  factory?: (url: string) => WebSocketLike;
  setTimeoutFn?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeoutFn?: (h: ReturnType<typeof setTimeout>) => void;
}

const MAX_BACKOFF_MS = 15_000;
const CUTOFF_MS = 10 * 60_000; // 10 minutes offline → mute 100%.

export class LullSocket {
  private ws: WebSocketLike | null = null;
  private ready = false;
  private stopped = false;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private cutoffTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly factory: (url: string) => WebSocketLike;
  private readonly setT: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  private readonly clearT: (h: ReturnType<typeof setTimeout>) => void;

  constructor(
    private readonly url: string,
    private readonly getHello: () => Promise<LullHello>,
    private readonly handlers: LullSocketHandlers,
    opts: LullSocketOpts = {},
  ) {
    this.factory =
      opts.factory ?? ((u) => new WebSocket(u) as unknown as WebSocketLike);
    this.setT = opts.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearT = opts.clearTimeoutFn ?? ((h) => clearTimeout(h));
  }

  start(): void {
    if (this.stopped) return;
    this.connect();
  }

  send(frame: unknown): void {
    if (!this.ready || !this.ws) return;
    try {
      this.ws.send(JSON.stringify(frame));
    } catch {
      // a failed send just means the socket is going down; onclose reconnects.
    }
  }

  stop(): void {
    this.stopped = true;
    this.ready = false;
    if (this.reconnectTimer) { this.clearT(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.cutoffTimer) { this.clearT(this.cutoffTimer); this.cutoffTimer = null; }
    if (this.ws) {
      try { this.ws.close(1000); } catch { /* ignore */ }
      this.ws = null;
    }
  }

  private connect(): void {
    let ws: WebSocketLike;
    try {
      ws = this.factory(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      void this.getHello().then((hello) => {
        if (this.stopped || this.ws !== ws) return;
        try {
          ws.send(JSON.stringify({ type: 'hello', ...hello }));
        } catch {
          this.scheduleReconnect();
        }
      });
    };
    ws.onmessage = (ev) => {
      let msg: { type?: string } & Partial<LullCmd>;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (msg.type === 'ready') {
        this.ready = true;
        this.attempt = 0;
        if (this.cutoffTimer) { this.clearT(this.cutoffTimer); this.cutoffTimer = null; }
        this.handlers.onReady();
      } else if (msg.type === 'cmd') {
        this.handlers.onCmd({
          tSec: msg.tSec ?? 0,
          W: msg.W ?? 0,
          volume: msg.volume ?? 0,
          phase: msg.phase ?? 'winddown',
          onset: Boolean(msg.onset),
        });
      }
    };
    ws.onerror = () => {
      try { ws.close(); } catch { /* ignore */ }
    };
    ws.onclose = () => {
      this.ready = false;
      if (this.ws === ws) this.ws = null;
      if (this.stopped) return;
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    // Start the 10-minute hard cutoff on the FIRST lost connection.
    if (this.cutoffTimer === null) {
      this.cutoffTimer = this.setT(() => {
        this.cutoffTimer = null;
        if (this.stopped) return;
        this.handlers.onMute();
        this.stop();
      }, CUTOFF_MS);
    }
    const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.attempt);
    this.attempt += 1;
    this.reconnectTimer = this.setT(() => {
      this.reconnectTimer = null;
      if (!this.stopped) this.connect();
    }, delay);
  }
}
