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
});
