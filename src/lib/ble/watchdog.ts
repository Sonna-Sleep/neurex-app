// Level-based data-stall watchdog for an in-progress recording.
//
// The reconnect path is edge-triggered on onDeviceDisconnected, which only
// fires when the BLE link actually drops. A firmware hang with the link still
// UP delivers no packets while the OS still reports "connected" — the session
// would otherwise sit connected-with-zero-data forever (historically real).
// This watchdog watches the stream's packet counter and, after
// WATCHDOG_STALL_TICKS consecutive ticks with no new packets, asks the caller
// to force the link down so the existing reconnect path fires.
//
// Pure + side-effect-free so it can be unit-tested without BLE/timers; the
// streamController owns the setInterval, the packet source, and the cancel.

// How often the watchdog samples the packet counter.
export const WATCHDOG_INTERVAL_MS = 10_000;
// Consecutive frozen samples before we force a reconnect (~20 s of no data in
// steady state; one extra grace tick right after a (re)connect re-baselines).
export const WATCHDOG_STALL_TICKS = 2;

export type WatchdogState = {
  // Packet count seen at the previous tick. -1 = no baseline yet (just started,
  // or just reset after a reconnect/fire) — the next tick only records, never judges.
  lastPackets: number;
  // Consecutive ticks the count has not advanced while connected.
  frozenTicks: number;
};

export function freshWatchdogState(): WatchdogState {
  return { lastPackets: -1, frozenTicks: 0 };
}

export type WatchdogTick = {
  state: WatchdogState;
  // True once the stream has been frozen long enough that the caller should
  // force a reconnect (e.g. manager.cancelDeviceConnection).
  forceReconnect: boolean;
};

// Advance the watchdog by one tick. `currentPackets` is the live stream packet
// count; `isReconnecting` is true while a reconnect is already in flight.
export function stallTick(
  prev: WatchdogState,
  currentPackets: number,
  isReconnecting: boolean,
): WatchdogTick {
  // A reconnect in flight is not a stall — no data is expected. Reset the
  // baseline so the freshly reconnected stream gets a full grace period.
  if (isReconnecting) {
    return { state: freshWatchdogState(), forceReconnect: false };
  }
  // No baseline yet: record this tick, judge from the next one.
  if (prev.lastPackets < 0) {
    return { state: { lastPackets: currentPackets, frozenTicks: 0 }, forceReconnect: false };
  }
  // Progressed (incl. a count DROP when a reconnect swapped in fresh stats) → healthy.
  if (currentPackets !== prev.lastPackets) {
    return { state: { lastPackets: currentPackets, frozenTicks: 0 }, forceReconnect: false };
  }
  // Frozen.
  const frozenTicks = prev.frozenTicks + 1;
  if (frozenTicks >= WATCHDOG_STALL_TICKS) {
    // Fire and clear the baseline so we don't immediately re-fire while the
    // reconnect spins up.
    return { state: freshWatchdogState(), forceReconnect: true };
  }
  return { state: { lastPackets: currentPackets, frozenTicks }, forceReconnect: false };
}
