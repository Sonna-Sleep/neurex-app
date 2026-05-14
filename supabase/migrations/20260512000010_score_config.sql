-- public.score_config: tunable weights + reference values for the Sleep Score
-- formula. Read by the Modal scoring step + by the app to show "why" tooltips.
-- All authenticated users can read; only service_role writes (admin tool).

create table public.score_config (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

alter table public.score_config enable row level security;

create policy "score_config: select authenticated"
  on public.score_config for select
  to authenticated
  using (true);

-- No INSERT / UPDATE / DELETE policy — only service_role writes via the admin
-- tool (Plan B-admin, post-v1).

-- Seed rows. Each value is jsonb so it can be a number, object, or array.
insert into public.score_config (key, value) values
  -- Weights of each score component. Must sum to 1.0.
  ('weights', '{
    "sleep_efficiency": 0.40,
    "deep_sleep":       0.25,
    "rem_sleep":        0.15,
    "awakenings":       0.10,
    "stim_impact":      0.10
  }'::jsonb),

  -- Age-expected deep sleep minutes (Ohayon 2004, midpoint of normal range).
  -- Lookup: pick the bin whose [min,max] contains the user's age.
  ('age_expected_deep_min', '[
    {"age_min": 18, "age_max": 25, "minutes": 75},
    {"age_min": 26, "age_max": 35, "minutes": 65},
    {"age_min": 36, "age_max": 50, "minutes": 55},
    {"age_min": 51, "age_max": 65, "minutes": 45},
    {"age_min": 66, "age_max": 99, "minutes": 35}
  ]'::jsonb),

  -- Age-expected REM minutes.
  ('age_expected_rem_min', '[
    {"age_min": 18, "age_max": 25, "minutes": 100},
    {"age_min": 26, "age_max": 35, "minutes":  95},
    {"age_min": 36, "age_max": 50, "minutes":  85},
    {"age_min": 51, "age_max": 65, "minutes":  80},
    {"age_min": 66, "age_max": 99, "minutes":  70}
  ]'::jsonb),

  -- Awakenings penalty: divide count by saturation; full penalty at saturation+
  ('awakenings_penalty', '{"saturation_count": 6}'::jsonb),

  -- Stim impact normalization: clamp(stim_swa_pct / saturation, 0, 1)
  ('stim_impact', '{"saturation_pct": 30}'::jsonb),

  -- 99-cap is intentional. Documented here so the admin tool can never raise
  -- it without an explicit policy change. See spec section 7.
  ('score_cap', '{"max": 99}'::jsonb);