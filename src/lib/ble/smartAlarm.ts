// Smart-alarm wake light: pure helpers for the alarm/control characteristic
// (6e6b...0006). The device runs the countdown itself once armed, so the
// sunrise fires even if BLE drops overnight - the app just re-arms with a
// freshly computed delay at session start, on reconnect, and when the user
// edits the alarm.
//
// Wire format is exactly what firmware 6a77ed5 parses: first byte = opcode,
// multi-byte fields little-endian. The firmware does not clamp any input, so
// this module rejects invalid values up front instead of silently wrapping
// them into the wire fields.
//   0x01 SET_ALARM_RELATIVE: [op][start_in_s u32][ramp_s u32][max_brightness][r][g][b] = 13 B
//   0x02 CANCEL_ALARM:       [op] = 1 B
//   0x03 START_RAMP_NOW:     [op][ramp_s u32][max_brightness][r][g][b] = 9 B

export const ALARM_OP_SET_RELATIVE = 0x01;
export const ALARM_OP_CANCEL = 0x02;
export const ALARM_OP_START_NOW = 0x03;

export type RgbColor = { r: number; g: number; b: number };

export const SUNRISE_LEAD_S = 30 * 60;
export const SUNRISE_RAMP_S = 30 * 60;
export const SMART_WAKE_PRE_ALARM_S = 30 * 60;
export const SMART_WAKE_FALLBACK_AFTER_S = 15 * 60;

// Salam's documented warm sunrise color at a deliberately low ceiling. 0x40
// is the highest brightness we allow here because the firmware applies no
// safety clamp and the strip/rail budget on the target hardware can be upset
// by caller bugs if we let arbitrary brightness values through.
export const SUNRISE_COLOR: RgbColor = { r: 255, g: 180, b: 80 };
export const SUNRISE_MAX_BRIGHTNESS = 0x40;

const U32_MAX = 0xffffffff;
const U8_MAX = 0xff;
const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;

function assertU32(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > U32_MAX) {
    throw new RangeError(`${name} must be an integer between 0 and 4294967295`);
  }
}

function assertU8(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > U8_MAX) {
    throw new RangeError(`${name} must be an integer between 0 and 255`);
  }
}

function assertHourMinute(name: string, value: number, maxExclusive: number): void {
  if (!Number.isInteger(value) || value < 0 || value >= maxExclusive) {
    throw new RangeError(`${name} must be an integer between 0 and ${maxExclusive - 1}`);
  }
}

function assertValidNowMs(nowMs: number): void {
  if (!Number.isFinite(nowMs)) {
    throw new RangeError('nowMs must be a finite number that creates a valid Date');
  }
  if (Number.isNaN(new Date(nowMs).getTime())) {
    throw new RangeError('nowMs must be a finite number that creates a valid Date');
  }
}

function assertColor(color: RgbColor): void {
  assertU8('color.r', color.r);
  assertU8('color.g', color.g);
  assertU8('color.b', color.b);
}

export function encodeSetAlarm(
  startInS: number,
  rampS: number,
  brightness: number,
  color: RgbColor,
): Uint8Array {
  assertU32('startInS', startInS);
  assertU32('rampS', rampS);
  assertU8('brightness', brightness);
  assertColor(color);

  const buf = new Uint8Array(13);
  const view = new DataView(buf.buffer);

  buf[0] = ALARM_OP_SET_RELATIVE;
  view.setUint32(1, startInS, true);
  view.setUint32(5, rampS, true);
  buf[9] = brightness;
  buf[10] = color.r;
  buf[11] = color.g;
  buf[12] = color.b;

  return buf;
}

export function encodeCancel(): Uint8Array {
  return Uint8Array.of(ALARM_OP_CANCEL);
}

export function encodeStartNow(
  rampS: number,
  brightness: number,
  color: RgbColor,
): Uint8Array {
  assertU32('rampS', rampS);
  assertU8('brightness', brightness);
  assertColor(color);

  const buf = new Uint8Array(9);
  const view = new DataView(buf.buffer);

  buf[0] = ALARM_OP_START_NOW;
  view.setUint32(1, rampS, true);
  buf[5] = brightness;
  buf[6] = color.r;
  buf[7] = color.g;
  buf[8] = color.b;

  return buf;
}

export function secondsUntilSunrise(
  nowMs: number,
  alarm: { hour: number; minute: number },
  leadS: number = SUNRISE_LEAD_S,
): number {
  assertValidNowMs(nowMs);
  assertU32('leadS', leadS);
  assertHourMinute('alarm.hour', alarm.hour, HOURS_PER_DAY);
  assertHourMinute('alarm.minute', alarm.minute, MINUTES_PER_HOUR);

  const wake = new Date(nowMs);
  wake.setHours(alarm.hour, alarm.minute, 0, 0);

  if (wake.getTime() <= nowMs) {
    wake.setDate(wake.getDate() + 1);
  }

  const startMs = wake.getTime() - leadS * 1000;
  return Math.max(0, Math.round((startMs - nowMs) / 1000));
}

export type SmartWakeTimes = {
  alarmAtMs: number;
  wakeWindowStartMs: number;
  fallbackDeadlineMs: number;
};

/** Resolve the next wall-clock alarm once, then derive the EEG monitoring and
 * hard fallback times from that same occurrence. Keeping one occurrence avoids
 * a midnight rollover assigning the three markers to different days.
 */
export function smartWakeTimes(
  nowMs: number,
  alarm: { hour: number; minute: number },
): SmartWakeTimes {
  assertValidNowMs(nowMs);
  assertHourMinute('alarm.hour', alarm.hour, HOURS_PER_DAY);
  assertHourMinute('alarm.minute', alarm.minute, MINUTES_PER_HOUR);
  const wake = new Date(nowMs);
  wake.setHours(alarm.hour, alarm.minute, 0, 0);
  if (wake.getTime() <= nowMs) wake.setDate(wake.getDate() + 1);
  const alarmAtMs = wake.getTime();
  return {
    alarmAtMs,
    wakeWindowStartMs: alarmAtMs - SMART_WAKE_PRE_ALARM_S * 1000,
    fallbackDeadlineMs: alarmAtMs + SMART_WAKE_FALLBACK_AFTER_S * 1000,
  };
}

/** Delay used by SET_ALARM_RELATIVE. The board is armed for +15 minutes, not
 * for the start of the pre-alarm window: live EEG may override it with
 * START_RAMP_NOW, while the board remains a phone-independent backstop.
 */
export function secondsUntilSmartWakeFallback(
  nowMs: number,
  alarm: { hour: number; minute: number },
): number {
  const { fallbackDeadlineMs } = smartWakeTimes(nowMs, alarm);
  return Math.max(0, Math.round((fallbackDeadlineMs - nowMs) / 1000));
}
