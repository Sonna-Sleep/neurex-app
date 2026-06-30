import { LullSocket, type WebSocketLike } from '../lullSocket';

class FakeSocket implements WebSocketLike {
  onopen: ((ev?: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  onerror: ((ev?: unknown) => void) | null = null;
  sent: string[] = [];
  closed = false;
  send(d: string) { this.sent.push(d); }
  close() { this.closed = true; this.onclose?.({ code: 1000 }); }
}

function harness() {
  const sockets: FakeSocket[] = [];
  const factory = () => { const s = new FakeSocket(); sockets.push(s); return s; };
  return { sockets, factory };
}

describe('LullSocket', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('sends hello on open and surfaces cmd after ready', async () => {
    const { sockets, factory } = harness();
    const cmds: unknown[] = [];
    const s = new LullSocket(
      'wss://x',
      async () => ({ token: 't', fs: 250, sessionId: 's1', lastVolume: 1 }),
      { onReady: () => undefined, onCmd: (c) => cmds.push(c), onMute: () => undefined },
      { factory },
    );
    s.start();
    sockets[0].onopen?.();
    await Promise.resolve(); // let getHello() resolve
    expect(JSON.parse(sockets[0].sent[0]).type).toBe('hello');
    sockets[0].onmessage?.({ data: JSON.stringify({ type: 'ready' }) });
    sockets[0].onmessage?.({ data: JSON.stringify({ type: 'cmd', tSec: 1, W: 0.5, volume: 0.8, phase: 'winddown', onset: false }) });
    expect(cmds).toHaveLength(1);
    expect((cmds[0] as { volume: number }).volume).toBe(0.8);
  });

  it('reconnects on unexpected close (capped backoff)', async () => {
    const { sockets, factory } = harness();
    const s = new LullSocket(
      'wss://x',
      async () => ({ token: 't', fs: 250, sessionId: 's1', lastVolume: 1 }),
      { onReady: () => undefined, onCmd: () => undefined, onMute: () => undefined },
      { factory },
    );
    s.start();
    sockets[0].onclose?.({ code: 1006 }); // unexpected drop
    jest.advanceTimersByTime(1000); // first backoff = 1 s
    expect(sockets).toHaveLength(2); // reconnected
  });

  it('mutes after 10 minutes offline', async () => {
    const { sockets, factory } = harness();
    let muted = false;
    const s = new LullSocket(
      'wss://x',
      async () => ({ token: 't', fs: 250, sessionId: 's1', lastVolume: 1 }),
      { onReady: () => undefined, onCmd: () => undefined, onMute: () => { muted = true; } },
      { factory },
    );
    s.start();
    sockets[0].onclose?.({ code: 1006 });
    jest.advanceTimersByTime(10 * 60_000);
    expect(muted).toBe(true);
  });

  it('caps reconnect backoff at 15s', async () => {
    const { sockets, factory } = harness();
    const s = new LullSocket(
      'wss://x',
      async () => ({ token: 't', fs: 250, sessionId: 's1', lastVolume: 1 }),
      { onReady: () => undefined, onCmd: () => undefined, onMute: () => undefined },
      { factory },
    );
    s.start();

    // attempt 0 → delay 1000ms
    sockets[0].onclose?.({ code: 1006 });
    jest.advanceTimersByTime(1000);
    expect(sockets).toHaveLength(2);

    // attempt 1 → delay 2000ms
    sockets[1].onclose?.({ code: 1006 });
    jest.advanceTimersByTime(2000);
    expect(sockets).toHaveLength(3);

    // attempt 2 → delay 4000ms
    sockets[2].onclose?.({ code: 1006 });
    jest.advanceTimersByTime(4000);
    expect(sockets).toHaveLength(4);

    // attempt 3 → delay 8000ms
    sockets[3].onclose?.({ code: 1006 });
    jest.advanceTimersByTime(8000);
    expect(sockets).toHaveLength(5);

    // attempt 4 → delay min(15000, 1000*2^4=16000) = 15000ms (cap)
    sockets[4].onclose?.({ code: 1006 });
    jest.advanceTimersByTime(14999);
    expect(sockets).toHaveLength(5); // not yet — cap holds
    jest.advanceTimersByTime(1);     // total = 15000ms
    expect(sockets).toHaveLength(6); // now reconnected
  });

  it('a successful reconnect clears the 10-minute cutoff so it never mutes', async () => {
    const { sockets, factory } = harness();
    let muted = false;
    const s = new LullSocket(
      'wss://x',
      async () => ({ token: 't', fs: 250, sessionId: 's1', lastVolume: 1 }),
      { onReady: () => undefined, onCmd: () => undefined, onMute: () => { muted = true; } },
      { factory },
    );
    s.start();

    // Drop the first connection — cutoff timer starts
    sockets[0].onclose?.({ code: 1006 });
    jest.advanceTimersByTime(1000); // first backoff = 1s
    expect(sockets).toHaveLength(2);

    // Successful reconnect: open + hello + ready → clears the cutoff timer
    sockets[1].onopen?.();
    await Promise.resolve(); // let getHello() resolve
    sockets[1].onmessage?.({ data: JSON.stringify({ type: 'ready' }) });

    // Now advance past the 10-minute mark — should NOT mute
    jest.advanceTimersByTime(10 * 60_000);
    expect(muted).toBe(false);
  });
});
