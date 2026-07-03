import {
  encodeSetAlarm,
  encodeCancel,
  encodeStartNow,
  secondsUntilSunrise,
  SUNRISE_LEAD_S,
} from '../smartAlarm';

describe('alarm/control command encoders (fw 6a77ed5, little-endian)', () => {
  const color = { r: 255, g: 180, b: 80 };

  it('encodes SET_ALARM_RELATIVE as 13 bytes: op + u32 start + u32 ramp + brightness + rgb', () => {
    // 9000 = 0x2328 → 28 23 00 00; 1800 = 0x0708 → 08 07 00 00
    expect(Array.from(encodeSetAlarm(9000, 1800, 200, color))).toEqual([
      0x01, 0x28, 0x23, 0x00, 0x00, 0x08, 0x07, 0x00, 0x00, 200, 255, 180, 80,
    ]);
  });

  it('encodes CANCEL_ALARM as a single opcode byte', () => {
    expect(Array.from(encodeCancel())).toEqual([0x02]);
  });

  it("encodes START_RAMP_NOW as 9 bytes matching Salam's 10s warm-white example", () => {
    // Salam's documented example: 03 0A 00 00 00 40 FF B4 50
    expect(Array.from(encodeStartNow(10, 0x40, color))).toEqual([
      0x03, 0x0a, 0x00, 0x00, 0x00, 0x40, 0xff, 0xb4, 0x50,
    ]);
  });

  it('rejects an invalid startInS instead of wrapping it into the wire field', () => {
    expect(() => encodeSetAlarm(-1, 1800, 200, color)).toThrow(
      new RangeError('startInS must be an integer between 0 and 4294967295'),
    );
  });

  it('rejects an invalid rampS instead of wrapping it into the wire field', () => {
    expect(() => encodeSetAlarm(9000, 4.2, 200, color)).toThrow(
      new RangeError('rampS must be an integer between 0 and 4294967295'),
    );
  });

  it('rejects an invalid brightness instead of wrapping it into the wire field', () => {
    expect(() => encodeSetAlarm(9000, 1800, 256, color)).toThrow(
      new RangeError('brightness must be an integer between 0 and 255'),
    );
  });

  it('rejects an invalid RGB channel instead of wrapping it into the wire field', () => {
    expect(() => encodeStartNow(10, 0x40, { r: 255, g: -1, b: 80 })).toThrow(
      new RangeError('color.g must be an integer between 0 and 255'),
    );
  });

  it('rejects an invalid RGB channel in SET_ALARM_RELATIVE payloads', () => {
    expect(() => encodeSetAlarm(9000, 1800, 200, { r: 255, g: 180, b: 300 })).toThrow(
      new RangeError('color.b must be an integer between 0 and 255'),
    );
  });

  it('rejects an invalid rampS in START_RAMP_NOW payloads', () => {
    expect(() => encodeStartNow(-1, 0x40, color)).toThrow(
      new RangeError('rampS must be an integer between 0 and 4294967295'),
    );
  });

  it('rejects an invalid brightness in START_RAMP_NOW payloads', () => {
    expect(() => encodeStartNow(10, 256, color)).toThrow(
      new RangeError('brightness must be an integer between 0 and 255'),
    );
  });
});

describe('secondsUntilSunrise', () => {
  // Local-time construction on purpose: the alarm is a wall-clock time.
  const at = (h: number, m: number) => new Date(2026, 6, 2, h, m, 0, 0).getTime();

  it('bedtime 22:00 with a 07:30 alarm → sunrise in 9.5 h minus the lead', () => {
    expect(secondsUntilSunrise(at(22, 0), { hour: 7, minute: 30 })).toBe(
      9.5 * 3600 - SUNRISE_LEAD_S,
    );
  });

  it('clamps to 0 when the wake time is nearer than the lead', () => {
    expect(secondsUntilSunrise(at(7, 10), { hour: 7, minute: 30 })).toBe(0);
  });

  it('rolls to tomorrow when the wake time just passed', () => {
    expect(secondsUntilSunrise(at(7, 31), { hour: 7, minute: 30 })).toBe(
      24 * 3600 - 60 - SUNRISE_LEAD_S,
    );
  });

  it('rejects an invalid alarm hour', () => {
    expect(() => secondsUntilSunrise(at(22, 0), { hour: 24, minute: 30 })).toThrow(
      new RangeError('alarm.hour must be an integer between 0 and 23'),
    );
  });

  it('rejects an invalid alarm minute', () => {
    expect(() => secondsUntilSunrise(at(22, 0), { hour: 7, minute: 60 })).toThrow(
      new RangeError('alarm.minute must be an integer between 0 and 59'),
    );
  });

  it('rejects a non-finite nowMs', () => {
    expect(() => secondsUntilSunrise(Number.NaN, { hour: 7, minute: 30 })).toThrow(
      new RangeError('nowMs must be a finite number that creates a valid Date'),
    );
  });

  it('rejects an invalid leadS', () => {
    expect(() => secondsUntilSunrise(at(22, 0), { hour: 7, minute: 30 }, 1.5)).toThrow(
      new RangeError('leadS must be an integer between 0 and 4294967295'),
    );
  });
});
