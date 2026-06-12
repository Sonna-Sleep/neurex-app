import { getSupabase } from '../auth/supabase';
import type { Session, SessionRepo } from './types';

// Columns on the public.sessions table. The nested jsonb columns
// (stage_minutes, epochs) are stored already in the app's shape.
const BASE_COLUMNS =
  'id,start_ms,end_ms,tib,tst,waso,efficiency,awakenings,' +
  'stage_minutes,epochs,score,confidence,sol,storage_prefix,status';
const SIGNAL_COLUMNS = 'excluded_minutes,signal_end_ms';
const COLUMNS = `${BASE_COLUMNS},${SIGNAL_COLUMNS}`;

type Row = {
  id: string;
  start_ms: number;
  end_ms: number;
  tib: number;
  tst: number;
  waso: number;
  efficiency: number;
  awakenings: number;
  stage_minutes: Session['stageMinutes'];
  epochs: Session['epochs'];
  score: number | null;
  confidence: number | null;
  sol: number | null;
  excluded_minutes: number | null;
  signal_end_ms: number | null;
  storage_prefix: string | null;
  status: string;
};

function missingOptionalSignalColumns(error: { message?: string } | null | undefined): boolean {
  const msg = (error?.message ?? '').toLowerCase();
  return msg.includes('column') && (msg.includes('excluded_minutes') || msg.includes('signal_end_ms'));
}

function toSession(r: Row): Session {
  return {
    id: r.id,
    startMs: r.start_ms,
    endMs: r.end_ms,
    tib: r.tib,
    tst: r.tst,
    waso: r.waso,
    efficiency: r.efficiency,
    awakenings: r.awakenings,
    // Defensive defaults: the DB columns are nullable and a half-staged row can
    // arrive with these null even when `score` is set. Never hand null to the
    // chart components — an empty shape renders cleanly instead of crashing.
    stageMinutes: r.stage_minutes ?? { wake: 0, light: 0, rem: 0, deep: 0 },
    epochs: r.epochs ?? [],
    score: r.score,
    confidence: r.confidence,
    sol: r.sol,
    excludedMinutes: r.excluded_minutes ?? 0,
    signalEndMs: r.signal_end_ms,
    storagePrefix: r.storage_prefix,
    status: r.status,
  };
}

// Reads sleep sessions from Supabase. Row-level security scopes every query to
// the signed-in user, so no user filter is needed here.
class SupabaseSessionRepo implements SessionRepo {
  async list(): Promise<Session[]> {
    const supabase = getSupabase();
    if (!supabase) return [];
    const { data, error } = await supabase
      .from('sessions')
      .select(COLUMNS)
      .order('start_ms', { ascending: false });
    if (error) {
      if (missingOptionalSignalColumns(error)) {
        const fallback = await supabase
          .from('sessions')
          .select(BASE_COLUMNS)
          .order('start_ms', { ascending: false });
        if (!fallback.error) return ((fallback.data as unknown as Row[] | null) ?? []).map(toSession);
      }
      // THROW (don't swallow → []). The Journal needs to tell "load failed"
      // (show retry) apart from "genuinely no sessions" (show empty). The old
      // []-on-error rendered a misleading "no sleep" on a transient hiccup.
      console.warn('[sessions] list failed:', error.message);
      throw new Error(`sessions list failed: ${error.message}`);
    }
    return ((data as unknown as Row[] | null) ?? []).map(toSession);
  }

  async latest(): Promise<Session | null> {
    const supabase = getSupabase();
    if (!supabase) return null;
    const { data, error } = await supabase
      .from('sessions')
      .select(COLUMNS)
      .order('start_ms', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      if (missingOptionalSignalColumns(error)) {
        const fallback = await supabase
          .from('sessions')
          .select(BASE_COLUMNS)
          .order('start_ms', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!fallback.error) return fallback.data ? toSession(fallback.data as unknown as Row) : null;
      }
      console.warn('[sessions] latest failed:', error.message);
      return null;
    }
    return data ? toSession(data as unknown as Row) : null;
  }

  async byId(id: string): Promise<Session | null> {
    const supabase = getSupabase();
    if (!supabase) return null;
    const { data, error } = await supabase
      .from('sessions')
      .select(COLUMNS)
      .eq('id', id)
      .maybeSingle();
    if (error) {
      if (missingOptionalSignalColumns(error)) {
        const fallback = await supabase
          .from('sessions')
          .select(BASE_COLUMNS)
          .eq('id', id)
          .maybeSingle();
        if (!fallback.error) return fallback.data ? toSession(fallback.data as unknown as Row) : null;
      }
      console.warn('[sessions] byId failed:', error.message);
      return null;
    }
    return data ? toSession(data as unknown as Row) : null;
  }
}

export const supabaseSessionRepo = new SupabaseSessionRepo();
