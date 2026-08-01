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
  }
}
```

All series use seconds from recording start. Position values are `left`, `right`, `back`, `stomach`, or `unknown`; quality is optional and ranges from 0–100. The app validates and sorts cloud JSON before charting it.

`possibleBreathingDisturbances` must remain a descriptive screening signal. It is not an apnea diagnosis, and the UI deliberately says so.
