import { CloudLullSession } from '../CloudLullSession';
import { feedLull } from '../engineTap';
import type { WebSocketLike } from '../../net/lullSocket';
import type { EegSample } from '../../../lib/ble/types';

jest.mock('../../../lib/auth/supabase', () => ({
  getSupabase: () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: 'jwt' } } }) },
  }),
}));

class FakeSocket implements WebSocketLike {
  onopen: ((ev?: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  onerror: ((ev?: unknown) => void) | null = null;
  sent: string[] = [];
  send(d: string) { this.sent.push(d); }
  close() { this.onclose?.({ code: 1000 }); }
}

function fakeSink() {
  return { setVolume: jest.fn(async (_v: number) => undefined), mute: jest.fn(async () => undefined), stop: jest.fn(async () => undefined) };
}

const sample = (fp1: number, fp2: number, l: number, r: number): EegSample => ({
  ms: 0, fp1_uV: fp1, channels: { Fp1: fp1, Fp2: fp2, 'EOG-L': l, 'EOG-R': r },
});

describe('CloudLullSession', () => {
  describe('hardMute no-false-onset', () => {
    beforeEach(() => { jest.useFakeTimers(); });
    afterEach(() => { jest.useRealTimers(); });

    it('does NOT emit a fake onset tick when the 10-min cutoff fires', async () => {
      const sockets: FakeSocket[] = [];
      const sink = fakeSink();
      const ticks: { onset: boolean }[] = [];
      const statuses: (string | null)[] = [];
      const s = new CloudLullSession(
        250, 's2', sink,
        (t) => ticks.push({ onset: t.onset }),
        (msg) => statuses.push(msg),
        { makeSocket: () => { const x = new FakeSocket(); sockets.push(x); return x; } },
      );
      s.start();
      // Drive handshake to ready
      sockets[0].onopen?.();
      await Promise.resolve(); await Promise.resolve(); // getHello + send
      sockets[0].onmessage?.({ data: JSON.stringify({ type: 'ready' }) });

      // Trigger unexpected disconnect — scheduleReconnect starts cutoff timer
      sockets[0].onclose?.({ code: 1006 });
      // Advance 10 minutes to fire the cutoff → onMute → hardMute
      jest.advanceTimersByTime(10 * 60_000);

      expect(sink.mute).toHaveBeenCalled();
      expect(statuses).toContain('Lost connection to Lull — music muted.');
      expect(ticks.every((t) => t.onset !== true)).toBe(true);
    });
  });

  describe('25-minute time fade', () => {
    beforeEach(() => { jest.useFakeTimers(); });
    afterEach(() => { jest.useRealTimers(); });

    async function startReady(sink: ReturnType<typeof fakeSink>, statuses: (string | null)[] = []) {
      const sockets: FakeSocket[] = [];
      const s = new CloudLullSession(
        250, 's3', sink, undefined,
        (msg) => statuses.push(msg),
        { makeSocket: () => { const x = new FakeSocket(); sockets.push(x); return x; } },
      );
      s.start();
      sockets[0].onopen?.();
      await Promise.resolve(); await Promise.resolve();
      sockets[0].onmessage?.({ data: JSON.stringify({ type: 'ready' }) });
      return { s, sockets };
    }

    it('gradually fades ~50% at 12.5 min, then 0% + stop at 25 min', async () => {
      const sink = fakeSink();
      const statuses: (string | null)[] = [];
      await startReady(sink, statuses);

      jest.advanceTimersByTime(12.5 * 60_000);
      const mid = sink.setVolume.mock.calls.at(-1)?.[0] as number;
      expect(mid).toBeGreaterThan(0.45);
      expect(mid).toBeLessThan(0.55);
      expect(sink.mute).not.toHaveBeenCalled();

      jest.advanceTimersByTime(12.5 * 60_000);
      expect(sink.mute).toHaveBeenCalled();
      expect(sink.stop).toHaveBeenCalled();
      expect(statuses).toContain('25-minute limit reached — music muted.');
    });

    it('applies the LOWER of brain volume and time fade (brain can go faster)', async () => {
      const sink = fakeSink();
      const { sockets } = await startReady(sink);
      jest.advanceTimersByTime(60_000); // time fade ~0.96
      sockets[0].onmessage?.({
        data: JSON.stringify({ type: 'cmd', tSec: 60, W: 0.3, volume: 0.2, phase: 'winddown', onset: false }),
      });
      expect(sink.setVolume).toHaveBeenLastCalledWith(0.2);
    });
  });

  it('forwards 4-channel samples and applies cmd volume; mutes + closes on onset', async () => {
    const sock: FakeSocket[] = [];
    const sink = fakeSink();
    const ticks: { volume: number; onset: boolean }[] = [];
    const s = new CloudLullSession(250, 's1', sink, (t) => ticks.push({ volume: t.volume, onset: t.onset }), undefined, {
      makeSocket: () => { const x = new FakeSocket(); sock.push(x); return x; },
    });
    s.start();
    sock[0].onopen?.();
    await Promise.resolve(); await Promise.resolve(); // getHello() + send
    sock[0].onmessage?.({ data: JSON.stringify({ type: 'ready' }) });

    feedLull([sample(10, 12, 3, -3), sample(11, 13, 4, -4)]);
    const frame = JSON.parse(sock[0].sent.find((m) => m.includes('samples'))!);
    expect(frame.fp1).toEqual([10, 11]);
    expect(frame.eogL).toEqual([3, 4]);

    sock[0].onmessage?.({ data: JSON.stringify({ type: 'cmd', tSec: 1, W: 0.4, volume: 0.7, phase: 'winddown', onset: false }) });
    expect(sink.setVolume).toHaveBeenLastCalledWith(0.7);

    sock[0].onmessage?.({ data: JSON.stringify({ type: 'cmd', tSec: 2, W: 0.1, volume: 0, phase: 'asleep', onset: true }) });
    expect(sink.mute).toHaveBeenCalled();
    expect(ticks[ticks.length - 1].onset).toBe(true);
  });

  describe('only-down volume ratchet + session log', () => {
    async function startReady(
      sink: ReturnType<typeof fakeSink>,
      extraDeps: Record<string, unknown> = {},
      storageLabel?: string,
    ) {
      const sockets: FakeSocket[] = [];
      const s = new CloudLullSession(
        250,
        'sess-1',
        sink,
        undefined,
        undefined,
        { makeSocket: () => { const x = new FakeSocket(); sockets.push(x); return x; }, ...extraDeps },
        storageLabel,
      );
      s.start();
      sockets[0].onopen?.();
      await Promise.resolve(); await Promise.resolve(); // getHello + send
      sockets[0].onmessage?.({ data: JSON.stringify({ type: 'ready' }) });
      return { s, sockets };
    }

    it('never raises the volume: a higher cmd after a lower one is clamped down', async () => {
      const sink = fakeSink();
      const { s, sockets } = await startReady(sink);
      sockets[0].onmessage?.({ data: JSON.stringify({ type: 'cmd', tSec: 1, W: 0.5, volume: 0.3, phase: 'winddown', onset: false }) });
      expect(sink.setVolume).toHaveBeenLastCalledWith(0.3);
      // The cloud (or a reconnect) asks for LOUDER — the ratchet must refuse.
      sockets[0].onmessage?.({ data: JSON.stringify({ type: 'cmd', tSec: 2, W: 0.9, volume: 0.8, phase: 'winddown', onset: false }) });
      expect(sink.setVolume).toHaveBeenLastCalledWith(0.3); // still 0.3, never 0.8
      const raised = sink.setVolume.mock.calls.some(([v]) => (v as number) > 0.3 + 1e-9);
      expect(raised).toBe(false);
      await s.stop();
    });

    it('writes the wind-down log (ticks + reason) on stop', async () => {
      const sink = fakeSink();
      const logs: { sessionId: string; log: any }[] = [];
      const { s, sockets } = await startReady(sink, {
        persistLog: (sessionId: string, log: unknown) => logs.push({ sessionId, log }),
      });
      sockets[0].onmessage?.({ data: JSON.stringify({ type: 'cmd', tSec: 1, W: 0.5, volume: 0.6, phase: 'winddown', onset: false }) });
      await s.stop();
      expect(logs).toHaveLength(1);
      expect(logs[0].sessionId).toBe('sess-1');
      expect(logs[0].log.reason).toBe('stopped');
      expect(logs[0].log.ticks.length).toBeGreaterThan(0);
      const last = logs[0].log.ticks[logs[0].log.ticks.length - 1];
      expect(last.volume).toBe(0.6);
      expect(last.brainVolume).toBe(0.6);
    });

    it('records reason "onset" + onsetTMs when sleep onset latches', async () => {
      const sink = fakeSink();
      const logs: any[] = [];
      const { sockets } = await startReady(sink, {
        persistLog: (_id: string, log: unknown) => logs.push(log),
      });
      sockets[0].onmessage?.({ data: JSON.stringify({ type: 'cmd', tSec: 3, W: 0.1, volume: 0, phase: 'asleep', onset: true }) });
      expect(logs).toHaveLength(1); // onset → stop() → persistLog runs synchronously
      expect(logs[0].reason).toBe('onset');
      expect(logs[0].onsetTMs).not.toBeNull();
    });

    it('sends the storage label + current volume in the hello frame', async () => {
      const sink = fakeSink();
      const { s, sockets } = await startReady(sink, {}, '2026-06-30_10-00PM_White_abc123');
      const hello = JSON.parse(sockets[0].sent.find((m) => m.includes('hello'))!);
      expect(hello.type).toBe('hello');
      expect(hello.label).toBe('2026-06-30_10-00PM_White_abc123');
      expect(hello.lastVolume).toBe(1.0); // ratchet floor at start
      await s.stop();
    });
  });
});
