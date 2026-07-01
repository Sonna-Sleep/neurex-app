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
  return { setVolume: jest.fn(async () => undefined), mute: jest.fn(async () => undefined), stop: jest.fn(async () => undefined) };
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

  describe('25-minute hard cap', () => {
    beforeEach(() => { jest.useFakeTimers(); });
    afterEach(() => { jest.useRealTimers(); });

    it('mutes and stops the session after 25 minutes', async () => {
      const sockets: FakeSocket[] = [];
      const sink = fakeSink();
      const statuses: (string | null)[] = [];
      const s = new CloudLullSession(
        250, 's3', sink, undefined,
        (msg) => statuses.push(msg),
        { makeSocket: () => { const x = new FakeSocket(); sockets.push(x); return x; } },
      );
      s.start();
      sockets[0].onopen?.();
      await Promise.resolve(); await Promise.resolve();
      sockets[0].onmessage?.({ data: JSON.stringify({ type: 'ready' }) });

      // Before 25 min: still playing.
      jest.advanceTimersByTime(24 * 60_000);
      expect(sink.mute).not.toHaveBeenCalled();

      // Cross 25 min: sound stops, session ends.
      jest.advanceTimersByTime(1 * 60_000);
      expect(sink.mute).toHaveBeenCalled();
      expect(sink.stop).toHaveBeenCalled();
      expect(statuses).toContain('25-minute limit reached — music stopped.');
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
});
