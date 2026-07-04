import { getSupabase } from '../../auth/supabase';
import { supabaseSessionRepo } from '../supabase';

jest.mock('../../auth/supabase', () => ({
  getSupabase: jest.fn(),
}));

const getSupabaseMock = getSupabase as jest.MockedFunction<typeof getSupabase>;

const fallbackRow = {
  id: 's1',
  start_ms: 1,
  end_ms: 2,
  tib: 3,
  tst: 4,
  waso: 5,
  efficiency: 6,
  awakenings: 7,
  stage_minutes: { wake: 1 },
  epochs: [],
  score: null,
  confidence: null,
  sol: null,
  excluded_minutes: null,
  signal_end_ms: null,
  storage_prefix: null,
  status: 'ready',
  error: null,
};
const signalFallbackRow = {
  ...fallbackRow,
  excluded_minutes: 12,
  signal_end_ms: 123_000,
};
const failedRow = {
  ...signalFallbackRow,
  id: 'failed',
  status: 'failed',
  error: 'recording mostly off-head / no contact',
};

describe('supabaseSessionRepo', () => {
  function oldDbError() {
    return { data: null, error: { message: 'column "head_movement" does not exist' } };
  }

  test('retries list without head_movement on old DBs and maps missing head movement to null', async () => {
    let selectCalls = 0;
    const select: any = jest.fn((_columns: string) => {
      selectCalls += 1;
      const response =
        selectCalls === 1
          ? oldDbError()
          : { data: [signalFallbackRow], error: null };
      return {
        order: jest.fn(() => Promise.resolve(response)),
      };
    });

    getSupabaseMock.mockReturnValue({
      from: jest.fn(() => ({ select })),
    } as never);

    const sessions = await supabaseSessionRepo.list();

    expect(select).toHaveBeenCalledTimes(2);
    expect(select.mock.calls[0][0]).toContain('head_movement');
    expect(select.mock.calls[1][0]).not.toContain('head_movement');
    expect(select.mock.calls[1][0]).toContain('excluded_minutes');
    expect(select.mock.calls[1][0]).toContain('signal_end_ms');
    expect(sessions).toHaveLength(1);
    expect(sessions[0].headMovement).toBeNull();
    expect(sessions[0].excludedMinutes).toBe(12);
    expect(sessions[0].signalEndMs).toBe(123_000);
  });

  test('maps backend failure reason onto failed sessions', async () => {
    const select: any = jest.fn(() => ({
      order: jest.fn(() => Promise.resolve({ data: [failedRow], error: null })),
    }));

    getSupabaseMock.mockReturnValue({
      from: jest.fn(() => ({ select })),
    } as never);

    const sessions = await supabaseSessionRepo.list();

    expect(select.mock.calls[0][0]).toContain('error');
    expect(sessions[0].status).toBe('failed');
    expect((sessions[0] as typeof sessions[0] & { error?: string | null }).error).toBe(
      'recording mostly off-head / no contact',
    );
  });

  test('retries latest without head_movement on old DBs and maps missing head movement to null', async () => {
    const select: any = jest.fn();
    select
      .mockImplementationOnce((_columns: string) => ({
        order: jest.fn(() => ({
          limit: jest.fn(() => ({
            maybeSingle: jest.fn(() => Promise.resolve(oldDbError())),
          })),
        })),
      }))
      .mockImplementationOnce((_columns: string) => ({
        order: jest.fn(() => ({
          limit: jest.fn(() => ({
            maybeSingle: jest.fn(() => Promise.resolve({ data: signalFallbackRow, error: null })),
          })),
        })),
      }));

    getSupabaseMock.mockReturnValue({
      from: jest.fn(() => ({ select })),
    } as never);

    const latest = await supabaseSessionRepo.latest();

    expect(select).toHaveBeenCalledTimes(2);
    expect(select.mock.calls[0][0]).toContain('head_movement');
    expect(select.mock.calls[1][0]).not.toContain('head_movement');
    expect(select.mock.calls[1][0]).toContain('excluded_minutes');
    expect(select.mock.calls[1][0]).toContain('signal_end_ms');
    expect(latest?.headMovement).toBeNull();
    expect(latest?.excludedMinutes).toBe(12);
    expect(latest?.signalEndMs).toBe(123_000);
  });

  test('retries byId without head_movement on old DBs and maps missing head movement to null', async () => {
    const select: any = jest.fn();
    select
      .mockImplementationOnce((_columns: string) => ({
        eq: jest.fn(() => ({
          maybeSingle: jest.fn(() => Promise.resolve(oldDbError())),
        })),
      }))
      .mockImplementationOnce((_columns: string) => ({
        eq: jest.fn(() => ({
            maybeSingle: jest.fn(() => Promise.resolve({ data: signalFallbackRow, error: null })),
        })),
      }));

    getSupabaseMock.mockReturnValue({
      from: jest.fn(() => ({ select })),
    } as never);

    const byId = await supabaseSessionRepo.byId('s1');

    expect(select).toHaveBeenCalledTimes(2);
    expect(select.mock.calls[0][0]).toContain('head_movement');
    expect(select.mock.calls[1][0]).not.toContain('head_movement');
    expect(select.mock.calls[1][0]).toContain('excluded_minutes');
    expect(select.mock.calls[1][0]).toContain('signal_end_ms');
    expect(byId?.headMovement).toBeNull();
    expect(byId?.excludedMinutes).toBe(12);
    expect(byId?.signalEndMs).toBe(123_000);
  });
});
