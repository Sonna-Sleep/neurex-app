-- Restrict which sessions columns an authenticated client may UPDATE.
--
-- Postgres RLS policies gate ROWS, not COLUMNS — the "sessions: update own"
-- policy in 20260512000004 lets a user update any column on their own row,
-- including sleep_score / sleep_strip / the staging metrics. That would let a
-- client fake its own Sleep Score.
--
-- Column-level GRANTs are the Postgres-native fix: RLS still decides WHICH
-- rows, this GRANT decides WHICH columns. service_role bypasses both, so the
-- Modal staging pipeline (Plan B8) can still write every column.
--
-- Per spec section 5 data flow, the phone legitimately updates only:
--   state        recording -> syncing -> staging  (Modal does -> ready)
--   end_ts       set when the recording stops
--   journal_tags edited on the Last Night screen (Plan B6)
-- Everything else (sleep_score, sleep_efficiency, min_in_*, stim_*,
-- sleep_strip, latency_s, awakenings, time_*) is Modal output and stays
-- client-immutable.

revoke update on public.sessions from authenticated;
grant  update (state, end_ts, journal_tags) on public.sessions to authenticated;
