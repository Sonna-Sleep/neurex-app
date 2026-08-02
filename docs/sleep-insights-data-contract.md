# Sleep insights data contract

The journal renders core staging metrics from the existing `sessions` columns. Optional sensor-derived cards read a versioned `sleep_insights` JSON object. Legacy databases and rows remain supported: if the column is absent, or a metric has not been computed, the app displays a specific empty state rather than fabricated data.

Add the optional column when the analysis backend is ready:

```sql
alter table public.sessions
  add column if not exists sleep_insights jsonb;
```

Example payload:

```json
{
  "schemaVersion": 1,
  "motion": {
    "turns": 9,
    "restlessMinutes": 14,
    "positions": [
      { "startSec": 0, "durationSec": 1800, "position": "left", "quality": 82 },
      { "startSec": 1800, "durationSec": 1200, "position": "back", "quality": 69 }
    ]
  },
  "cardio": {
    "heartRateBpm": {
      "average": 58,
      "min": 49,
      "max": 77,
      "series": [{ "offsetSec": 0, "value": 62 }]
    },
    "hrvRmssdMs": {
      "average": 47,
      "series": [{ "offsetSec": 0, "value": 43 }]
    },
    "respirationRate": {
      "average": 13.8,
      "series": [{ "offsetSec": 0, "value": 14.2 }]
    }
  },
  "eyeMovements": {
    "events": 113,
    "eventsPerHour": 15.1,
    "remDensity": 24,
    "series": [{ "offsetSec": 0, "value": 0 }]
  },
  "sound": {
    "snoringMinutes": 11,
    "snoringEpisodes": 7,
    "possibleBreathingDisturbances": 2,
    "series": [{ "offsetSec": 0, "value": 18 }]
  },
  "brain": {
    "microArousals": { "count": 12, "indexPerHour": 1.7, "series": [] },
    "spindles": { "count": 932, "densityPerMinute": 2.8, "series": [] },
    "slowOscillations": { "count": 417, "densityPerMinute": 1.4, "series": [] },
    "slowWaveActivity": { "average": 143.2, "series": [] }
  },
  "environment": {
    "temperatureC": { "average": 19.4, "series": [] },
    "co2Ppm": { "average": 840, "series": [] },
    "humidityPercent": { "average": 44, "series": [] },
    "correlations": [
      { "factor": "Room temperature", "outcome": "Deep sleep", "coefficient": -0.31, "sampleNights": 18 }
    ]
  },
  "circadian": {
    "estimatedDlmoMs": 1785472200000,
    "uncertaintyMinutes": 52,
    "phaseOffsetMinutes": 24,
    "confidence": 0.78,
    "chronotype": "intermediate",
    "timingWindows": [
      { "kind": "morningLight", "startMs": 1785501000000, "endMs": 1785504600000 },
      { "kind": "screensOff", "startMs": 1785540600000, "endMs": 1785544200000 }
    ]
  },
  "closedLoop": {
    "deepSleepStimulations": 18,
    "acceptedStimulations": 14,
    "slowWaveDeltaPercent": 4.2,
    "events": [{ "offsetSec": 7200, "kind": "pinkNoise", "responseDeltaPercent": 3.1 }]
  },
  "quality": {
    "usableSignalPercent": 94,
    "artifactMinutes": 17,
    "modelVersion": "neurex-staging-v3",
    "sensorCoverage": { "eeg": 94, "eog": 91, "imu": 99, "ppg": 86, "audio": 93 }
  }
}
```

All series use seconds from recording start. Position values are `left`, `right`, `back`, `stomach`, or `unknown`; quality is optional and ranges from 0–100. The app validates and sorts cloud JSON before charting it.

Correlation coefficients are clamped to -1…1 and always paired with `sampleNights`. Circadian timing is an estimate: use `uncertaintyMinutes` and `confidence` from the model rather than presenting a single precise time without qualification. Supported timing-window kinds are `morningLight`, `exercise`, `lastMeal`, and `screensOff`. Closed-loop events support `pinkNoise`, `windDownAudio`, `wakeLight`, and `other`.

`possibleBreathingDisturbances` must remain a descriptive screening signal. It is not an apnea diagnosis, and the UI deliberately says so.
