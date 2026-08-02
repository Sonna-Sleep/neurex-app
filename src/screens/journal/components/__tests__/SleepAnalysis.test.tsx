import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import type { Session } from '../../../../lib/repos';
import { SleepAnalysis, SleepAnalysisPreview } from '../SleepAnalysis';

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 'night-1',
    startMs: Date.UTC(2026, 6, 30, 6),
    endMs: Date.UTC(2026, 6, 30, 14),
    tib: 480,
    tst: 430,
    waso: 23,
    efficiency: 89.6,
    awakenings: 4,
    stageMinutes: { wake: 50, light: 230, rem: 110, deep: 90 },
    epochs: [],
    score: 84,
    confidence: 0.89,
    sol: 17,
    excludedMinutes: 0,
    signalEndMs: null,
    storagePrefix: null,
    status: 'ready',
    insights: null,
    ...overrides,
  };
}

describe('SleepAnalysis', () => {
  it('makes advanced features discoverable before a completed night exists', async () => {
    await render(<SleepAnalysisPreview />);

    expect(screen.getByText('Your overnight signals')).toBeTruthy();
    expect(screen.getByText('Heart and breathing')).toBeTruthy();
    expect(screen.getByText('Toss and turn map')).toBeTruthy();
    expect(screen.getByText('Overnight eye activity')).toBeTruthy();
    expect(screen.getByLabelText('Awaiting PPG data; graph has no readings yet')).toBeTruthy();
    expect(screen.getByLabelText('Awaiting sound data; graph has no readings yet')).toBeTruthy();
    expect(screen.getByText('Brain, context, and closed-loop response')).toBeTruthy();
    expect(screen.getByText('Arousals, spindles, and slow waves')).toBeTruthy();
    expect(screen.getByText('Your estimated body clock')).toBeTruthy();
  });

  it('uses calculated staging metrics and honest sensor empty states', async () => {
    await render(<SleepAnalysis session={session()} history={[]} />);

    expect(screen.getByText('7h 10m')).toBeTruthy();
    expect(screen.getByText('17 min')).toBeTruthy();
    expect(screen.getByText('Waiting for PPG data')).toBeTruthy();
    expect(screen.getByText('Waiting for IMU analysis')).toBeTruthy();
    expect(screen.getByText('Waiting for eye-movement analysis')).toBeTruthy();
    expect(screen.getByText('No sound analysis for this night')).toBeTruthy();
  });

  it('renders available sensor metrics and switches interactive signal tabs', async () => {
    await render(
      <SleepAnalysis
        session={session({
          insights: {
            schemaVersion: 1,
            cardio: {
              heartRateBpm: { average: 58, series: [{ offsetSec: 0, value: 58 }] },
              respirationRate: { average: 13.8, series: [{ offsetSec: 0, value: 13.8 }] },
            },
            motion: { turns: 8, restlessMinutes: 12 },
            eyeMovements: { events: 105, eventsPerHour: 14.7, remDensity: 23 },
            sound: { snoringMinutes: 8, snoringEpisodes: 4 },
            brain: {
              microArousals: { count: 12, indexPerHour: 1.7 },
              spindles: { count: 900, densityPerMinute: 2.8 },
            },
            environment: {
              temperatureC: { average: 19.4 },
              correlations: [
                { factor: 'Room temperature', outcome: 'Deep sleep', coefficient: -0.31, sampleNights: 12 },
              ],
            },
            closedLoop: { deepSleepStimulations: 18, acceptedStimulations: 14 },
            quality: { usableSignalPercent: 94, modelVersion: 'neurex-staging-v3' },
          },
        })}
        history={[]}
      />,
    );

    expect(screen.getByText('58')).toBeTruthy();
    expect(screen.getByText('105')).toBeTruthy();
    expect(screen.getByText('Tosses and turns')).toBeTruthy();
    expect(screen.getByText('Did the intervention respond?')).toBeTruthy();
    expect(screen.getByText('Room temperature')).toBeTruthy();
    expect(screen.getByText('neurex-staging-v3')).toBeTruthy();

    await fireEvent.press(screen.getByText('Breathing'));
    expect(screen.getByText('13.8')).toBeTruthy();
  });
});
