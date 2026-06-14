import type { CoreSleepStage, Epoch, SleepStage } from '../../../lib/repos';

export type HypnogramRun = {
  stage: SleepStage;
  startMs: number;
  durationMs: number;
};

const RENDERABLE_STAGES = new Set<string>(['wake', 'rem', 'light', 'deep', 'excluded']);

export function isCoreSleepStage(stage: SleepStage): stage is CoreSleepStage {
  return stage !== 'excluded';
}

export function collapseHypnogramRuns(epochs: Epoch[]): HypnogramRun[] {
  const runs: HypnogramRun[] = [];
  for (const e of epochs) {
    if (!RENDERABLE_STAGES.has(e.stage)) continue;
    const last = runs[runs.length - 1];
    if (last && last.stage === e.stage) {
      last.durationMs += e.durationSec * 1000;
    } else {
      runs.push({
        stage: e.stage,
        startMs: e.startMs,
        durationMs: e.durationSec * 1000,
      });
    }
  }
  return runs;
}
