type FsNode =
  | { type: 'dir'; mtime: number }
  | { type: 'file'; bytes: Uint8Array; mtime: number };

const mockFs = (() => {
  const nodes = new Map<string, FsNode>();
  const now = () => Date.now();
  const normalize = (path: string) => path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '') || '/';
  const pathOf = (...parts: unknown[]): string => {
    const raw = parts
      .map((part) => {
        if (part instanceof MockDirectory || part instanceof MockFile) return part.uri;
        return String(part);
      })
      .join('/');
    return normalize(raw);
  };
  const parentOf = (path: string) => normalize(path.split('/').slice(0, -1).join('/') || '/');
  const nameOf = (path: string) => path.split('/').pop() ?? '';
  const textBytes = (text: string) => new TextEncoder().encode(text);

  class MockDirectory {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = pathOf(...parts);
    }
    get exists(): boolean {
      return nodes.get(this.uri)?.type === 'dir';
    }
    create(): void {
      const parent = parentOf(this.uri);
      if (parent !== this.uri && !nodes.has(parent)) nodes.set(parent, { type: 'dir', mtime: now() });
      nodes.set(this.uri, { type: 'dir', mtime: now() });
    }
    delete(): void {
      for (const key of Array.from(nodes.keys())) {
        if (key === this.uri || key.startsWith(`${this.uri}/`)) nodes.delete(key);
      }
    }
    list(): (MockDirectory | MockFile)[] {
      const prefix = `${this.uri}/`;
      const seen = new Set<string>();
      const out: (MockDirectory | MockFile)[] = [];
      for (const key of nodes.keys()) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        if (!rest || rest.includes('/')) continue;
        if (seen.has(rest)) continue;
        seen.add(rest);
        const child = `${prefix}${rest}`;
        out.push(nodes.get(child)?.type === 'dir' ? new MockDirectory(child) : new MockFile(child));
      }
      return out.sort((a, b) => nameOf(a.uri).localeCompare(nameOf(b.uri)));
    }
  }

  class MockFile {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = pathOf(...parts);
    }
    get exists(): boolean {
      return nodes.get(this.uri)?.type === 'file';
    }
    get size(): number {
      const node = nodes.get(this.uri);
      return node?.type === 'file' ? node.bytes.byteLength : 0;
    }
    get modificationTime(): number {
      const node = nodes.get(this.uri);
      return node?.mtime ?? now();
    }
    create(): void {
      const parent = parentOf(this.uri);
      if (!nodes.has(parent)) nodes.set(parent, { type: 'dir', mtime: now() });
      nodes.set(this.uri, { type: 'file', bytes: new Uint8Array(0), mtime: now() });
    }
    delete(): void {
      nodes.delete(this.uri);
    }
    write(input: string | Uint8Array): void {
      const bytes = typeof input === 'string' ? textBytes(input) : input;
      nodes.set(this.uri, { type: 'file', bytes: new Uint8Array(bytes), mtime: now() });
    }
    textSync(): string {
      const node = nodes.get(this.uri);
      if (node?.type !== 'file') return '';
      return new TextDecoder().decode(node.bytes);
    }
    info(): { exists: boolean; size?: number } {
      return this.exists ? { exists: true, size: this.size } : { exists: false };
    }
    open(): { offset: number; readBytes: (length: number) => Uint8Array; writeBytes: (bytes: Uint8Array) => void; close: () => void } {
      if (!this.exists) this.create();
      let offset = 0;
      return {
        get offset() {
          return offset;
        },
        set offset(value: number) {
          offset = value;
        },
        readBytes: (length: number) => {
          const node = nodes.get(this.uri);
          const bytes = node?.type === 'file' ? node.bytes : new Uint8Array(0);
          const chunk = bytes.slice(offset, offset + length);
          offset += chunk.byteLength;
          return chunk;
        },
        writeBytes: (bytes: Uint8Array) => {
          const node = nodes.get(this.uri);
          const existing = node?.type === 'file' ? node.bytes : new Uint8Array(0);
          const next = new Uint8Array(Math.max(existing.byteLength, offset + bytes.byteLength));
          next.set(existing);
          next.set(bytes, offset);
          offset += bytes.byteLength;
          nodes.set(this.uri, { type: 'file', bytes: next, mtime: now() });
        },
        close: () => undefined,
      };
    }
  }

  return {
    Paths: { document: '/doc', cache: '/cache' },
    Directory: MockDirectory,
    File: MockFile,
    reset() {
      nodes.clear();
      nodes.set('/doc', { type: 'dir', mtime: now() });
      nodes.set('/cache', { type: 'dir', mtime: now() });
    },
    mkdir(path: string) {
      new MockDirectory(path).create();
    },
    write(path: string, bytes: Uint8Array | string) {
      const file = new MockFile(path);
      file.create();
      file.write(bytes);
    },
    exists(path: string) {
      return nodes.has(normalize(path));
    },
    text(path: string) {
      return new MockFile(path).textSync();
    },
  };
})();

const mockSupabase = {
  auth: { getUser: jest.fn() },
  storage: { from: jest.fn() },
  from: jest.fn(),
  channel: jest.fn(),
  removeChannel: jest.fn(),
};

jest.mock('expo-file-system', () => ({
  Paths: mockFs.Paths,
  Directory: mockFs.Directory,
  File: mockFs.File,
}));

jest.mock('react-native', () => ({
  AppState: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
  Platform: { OS: 'android' },
}));

jest.mock('../../auth/supabase', () => ({
  getSupabase: () => mockSupabase,
}));

jest.mock('../../repos/supabase', () => ({
  supabaseSessionRepo: { byId: jest.fn() },
}));

jest.mock('../../../state/diagnostics', () => ({
  useDiagnostics: { getState: () => ({ lastTesterLog: null }) },
}));

jest.mock('../streamStatsSidecar', () => ({
  ensureStreamStatsSidecar: jest.fn().mockResolvedValue(undefined),
  refreshStreamStatsSidecarUploadCounts: jest.fn().mockResolvedValue(undefined),
  streamStatsFile: jest.fn(() => ({ exists: false })),
}));

describe('local recording retention after cloud handoff', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockFs.reset();
    mockFs.mkdir('/doc/sessions');
    mockFs.mkdir('/doc/sessions/session-1');
    mockFs.write('/doc/sessions/session-1/RAW.BIN', new Uint8Array([0x4e, 0x52, 0x58, 0x31, 1, 2, 3, 4]));
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'uid-1' } }, error: null });
    mockSupabase.storage.from.mockReturnValue({
      list: jest.fn().mockResolvedValue({ data: [], error: null }),
      download: jest.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }),
      upload: jest.fn().mockResolvedValue({ error: null }),
    });
    mockSupabase.from.mockReturnValue({
      insert: jest.fn().mockResolvedValue({ error: null }),
      select: jest.fn(),
    });
    mockSupabase.channel.mockReturnValue({ on: jest.fn().mockReturnThis(), subscribe: jest.fn() });
  });

  test('transmitSession keeps the phone copy and writes an upload receipt', async () => {
    const { transmitSession } = await import('../cloudSync');

    await transmitSession({ sessionId: 'session-1', startMs: 1_800_000_000_000, endMs: 1_800_000_600_000 });

    expect(mockFs.exists('/doc/sessions/session-1')).toBe(true);
    expect(mockFs.exists('/doc/sessions/session-1/RAW.BIN')).toBe(true);
    const receipt = JSON.parse(mockFs.text('/doc/sessions/session-1/upload_receipt.json'));
    expect(receipt).toMatchObject({
      schemaVer: 1,
      sessionId: 'session-1',
      storagePrefix: expect.stringContaining('uid-1/'),
      rawStoragePath: expect.stringContaining('/segments/raw'),
    });
    expect(typeof receipt.rawSha256).toBe('string');
    expect(receipt.rawSha256.length).toBe(64);
  });

  test('already-uploaded local copies are not recovered again as orphan uploads', async () => {
    const { scanRecoverable } = await import('../recovery');
    mockFs.write(
      '/doc/sessions/session-1/upload_receipt.json',
      JSON.stringify({ schemaVer: 1, sessionId: 'session-1', uploadedAtMs: 1 }),
    );

    expect(scanRecoverable(null)).toEqual([]);
  });
});
