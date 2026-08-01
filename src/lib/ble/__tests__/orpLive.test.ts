import { LiveOrpProcessor, spectralBandPowers } from '../orpLive';
import type { EegSample, ParsedPacket } from '../types';

const FS = 250;

function sine(hz: number, seconds: number, amplitude = 20): number[] {
  return Array.from(
    { length: FS * seconds },
    (_, i) => amplitude * Math.sin((2 * Math.PI * hz * i) / FS),
  );
}

function packet(values: number[], startMs = 0): ParsedPacket {
  const samples: EegSample[] = values.map((value, i) => ({
    ms: startMs + i * 4,
    fp1_uV: value,
    channels: { Fp1: value, Fp2: value, 'EOG-L': 0, 'EOG-R': 0 },
  }));
  return { generation: 0, seq: 0, baseMs: startMs, samples };
}

describe('causal live ORP-like processor', () => {
  test('places a 10 Hz sine primarily in alpha/sigma', () => {
    const powers = spectralBandPowers(sine(10, 3), FS);
    expect(powers[2]).toBeGreaterThan(powers[0]);
    expect(powers[2]).toBeGreaterThan(powers[1]);
    expect(powers[2]).toBeGreaterThan(powers[3]);
  });

  test('calibrates only from prior complete windows and emits every 3 seconds', () => {
    const processor = new LiveOrpProcessor(FS);
    const snapshots = processor.feedPacket(packet(sine(10, 33)));
    expect(snapshots).toHaveLength(11);
    expect(snapshots.slice(0, 10).every((s) => s.rawScore === null)).toBe(true);
    expect(snapshots[10].rawScore).not.toBeNull();
    expect(snapshots[10].rawScore).toBeGreaterThanOrEqual(0);
    expect(snapshots[10].rawScore).toBeLessThanOrEqual(2.5);
  });

  test('does not bridge a three-second window across a timestamp gap', () => {
    const processor = new LiveOrpProcessor(FS);
    const almost = sine(10, 3).slice(0, 749);
    expect(processor.feedPacket(packet(almost))).toHaveLength(0);
    expect(processor.feedPacket(packet([0], 10_000))).toHaveLength(0);
  });

  test('rejects high-amplitude artifact windows', () => {
    const processor = new LiveOrpProcessor(FS);
    const snapshots = processor.feedPacket(packet(sine(10, 3, 1000)));
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].validChannels).toBe(0);
    expect(snapshots[0].artifactBurden).toBe(1);
  });
});
