export type FoundDevice = {
  serial: string;
  rssi: number;
};

export type PairFlow = {
  scan(onFound: (device: FoundDevice) => void): () => void;
  pair(serial: string): Promise<void>;
};

export const pairFlowStub: PairFlow = {
  scan(onFound) {
    const t = setTimeout(() => {
      onFound({ serial: 'NRX-ABC123', rssi: -52 });
    }, 1800);
    return () => clearTimeout(t);
  },
  async pair(_serial: string) {
    await new Promise((r) => setTimeout(r, 700));
  },
};
