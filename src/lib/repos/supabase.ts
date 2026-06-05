import { getSupabase } from '../auth/supabase';
import type { Session, SessionRepo } from './types';

// Columns on the public.sessions table. The nested jsonb columns
// (stage_minutes, epochs, stim_pulses) are stored already in the app's shape.
const COLUMNS =
  'id,start_ms,end_ms,tib,tst,waso,efficiency,awakenings,' +
  'stage_minutes,epochs,stim_pulses,stim_impact_pct,score,storage_prefix,status';

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
  stim_pulses: Session['stimPulses'];
  stim_impact_pct: number | null;
  score: number | null;
  storage_prefix: string | null;
  status: string;
};

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
    stageMinutes: r.stage_minutes,
    epochs: r.epochs,
    stimPulses: r.stim_pulses,
    stimImpactPct: r.stim_impact_pct,
    score: r.score,
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
      console.warn('[sessions] list failed:', error.message);
      return [];
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
      console.warn('[sessions] byId failed:', error.message);
      return null;
    }
    return data ? toSession(data as unknown as Row) : null;
  }
}

export const supabaseSessionRepo = new SupabaseSessionRepo();
