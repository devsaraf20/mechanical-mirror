import { describe, it, expect } from 'vitest';
import { brightnessToAngle, DEFAULT_MAPPING } from '../src/core/mapping.js';
import { MotionPlanner } from '../src/core/motion.js';
import { sizeSupply, SERVO_PROFILES } from '../src/core/power.js';
import { encodeMessage, decodeMessage } from '../src/bridge/osc.js';
import { encodeFrameOSC, encodeFrameJSON, decodeAny, packAngles, unpackAngles } from '../src/bridge/physicalBridge.js';
import { textColumns } from '../src/modes/font5x7.js';

describe('mapping', () => {
  const m = { ...DEFAULT_MAPPING, darkAngle: -30, brightAngle: 20 };
  it('maps ends and midpoint', () => {
    expect(brightnessToAngle(0, m)).toBe(-30);
    expect(brightnessToAngle(1, m)).toBe(20);
    expect(brightnessToAngle(0.5, m)).toBe(-5);
  });
  it('inverts and clamps to hard limits', () => {
    expect(brightnessToAngle(0, { ...m, invert: true })).toBe(20);
    expect(brightnessToAngle(1, { ...m, brightAngle: 80, limitMax: 45 })).toBe(45);
  });
  it('quantizes', () => {
    expect(brightnessToAngle(0.4, { ...m, quantize: 2 })).toBe(-30);
    expect(brightnessToAngle(0.6, { ...m, quantize: 2 })).toBe(20);
  });
});

describe('motion planner', () => {
  it('never exceeds max speed or max accel', () => {
    const p = { smoothing: 0, maxSpeed: 100, maxAccel: 1000, deadband: 0 };
    const mp = new MotionPlanner(1, 0);
    mp.setTargets([60], 0);
    let prev = 0;
    let prevV = 0;
    const dt = 1 / 60;
    for (let i = 0; i < 120; i++) {
      const a = mp.step(dt, p)[0];
      const v = (a - prev) / dt;
      expect(Math.abs(v)).toBeLessThanOrEqual(100 + 1e-3);
      expect(Math.abs(v - prevV) / dt).toBeLessThanOrEqual(1000 + 1e-2 + 100 / dt * 0); // accel bound
      prev = a;
      prevV = v;
    }
    expect(prev).toBeCloseTo(60, 3); // arrives without overshoot
  });
  it('does not overshoot when reversing', () => {
    const p = { smoothing: 0.05, maxSpeed: 300, maxAccel: 2000, deadband: 0 };
    const mp = new MotionPlanner(1, 0);
    mp.setTargets([40], 0);
    for (let i = 0; i < 20; i++) mp.step(1 / 60, p);
    mp.setTargets([-10], 0);
    let max = -Infinity;
    for (let i = 0; i < 300; i++) max = Math.max(max, mp.step(1 / 60, p)[0]);
    expect(max).toBeLessThanOrEqual(40);
    expect(mp.angle[0]).toBeCloseTo(-10, 2);
  });
  it('deadband ignores small target changes', () => {
    const mp = new MotionPlanner(1, 0);
    mp.setTargets([0.2], 0.5);
    expect(mp.target[0]).toBe(0);
  });
});

describe('OSC + Physical Bridge', () => {
  it('round-trips OSC messages', () => {
    const bytes = encodeMessage('/x', [
      { type: 'i', value: -7 },
      { type: 'f', value: 1.5 },
      { type: 's', value: 'hey' },
      { type: 'b', value: new Uint8Array([1, 2, 3]) },
    ]);
    expect(bytes.length % 4).toBe(0);
    const m = decodeMessage(bytes);
    expect(m.address).toBe('/x');
    expect(m.args[0]).toBe(-7);
    expect(m.args[1]).toBe(1.5);
    expect(m.args[2]).toBe('hey');
    expect(Array.from(m.args[3])).toEqual([1, 2, 3]);
  });
  it('packs angles to 0.1° int16', () => {
    expect(Array.from(unpackAngles(packAngles([12.34, -45, 0])))).toEqual([12.3, -45, 0]);
  });
  it('encodes frames identically in OSC and JSON', () => {
    const f = { seq: 3, cols: 2, rows: 2, angles: [1, -2.5, 30, -30] };
    const a = decodeAny(encodeFrameOSC(f));
    const b = decodeAny(encodeFrameJSON(f));
    expect(a.angles).toEqual(b.angles);
    expect([a.cols, a.rows, a.seq]).toEqual([2, 2, 3]);
    // Header layout the ESP32 parser relies on: "/pb/frame\0\0\0" ",iiib\0\0\0"
    const bytes = encodeFrameOSC(f);
    expect(new TextDecoder().decode(bytes.subarray(0, 9))).toBe('/pb/frame');
    expect(new TextDecoder().decode(bytes.subarray(12, 17))).toBe(',iiib');
    expect(bytes.length).toBe(12 + 8 + 12 + 4 + 8);
  });
});

describe('power sizing', () => {
  it('144 MG90S servos need tens of amps, split in zones', () => {
    const r = sizeSupply({ servos: 144, profile: SERVO_PROFILES['MG90S (5V)'] });
    expect(r.zones).toBe(3);
    expect(r.continuousA).toBeGreaterThan(20);
    expect(r.continuousA).toBeLessThan(60);
    expect(r.zoneSupplyA).toBeGreaterThanOrEqual(r.zoneContinuousA);
  });
});

describe('font', () => {
  it('renders 6 columns per glyph', () => {
    expect(textColumns('AB').length).toBe(12);
  });
});
