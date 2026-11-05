// Power-supply model for many hobby servos. Shared by the in-app live
// estimate and scripts/power-calc.mjs. Numbers are deliberately conservative
// defaults for MG90S/SG90-class micro servos at 5–6 V; measure your own servo
// (idle, moving, stall) with a bench supply and replace them.

export const SERVO_PROFILES = {
  'SG90 (5V)': { idle: 0.008, moving: 0.22, stall: 0.65, nominalSpeed: 600 },
  'MG90S (5V)': { idle: 0.01, moving: 0.28, stall: 0.8, nominalSpeed: 550 },
  'MG90S (6V)': { idle: 0.012, moving: 0.35, stall: 1.0, nominalSpeed: 650 },
  'ES08MA II (5V)': { idle: 0.01, moving: 0.25, stall: 0.75, nominalSpeed: 600 },
};

export const DEFAULT_PROFILE = 'MG90S (5V)';

/**
 * Static sizing calculation.
 * @param {object} o
 * @param {number} o.servos         number of servos
 * @param {object} o.profile        one of SERVO_PROFILES (amps)
 * @param {number} o.duty           fraction of servos moving at the same time in normal use (0..1)
 * @param {number} o.stallFraction  fraction that may be stalled/blocked at once (jammed tile, startup)
 * @param {number} o.headroom       safety factor on the continuous figure (e.g. 1.3 = +30 %)
 * @param {number} o.voltage        supply voltage
 * @param {number} o.zoneSize       servos per supply/fuse zone
 */
export function sizeSupply({
  servos = 144,
  profile = SERVO_PROFILES[DEFAULT_PROFILE],
  duty = 0.6,
  stallFraction = 0.05,
  headroom = 1.3,
  voltage = 5,
  zoneSize = 48,
} = {}) {
  const idleA = servos * profile.idle;
  const typicalA = servos * (profile.idle + duty * (profile.moving - profile.idle));
  const stallA = servos * stallFraction * (profile.stall - profile.moving);
  const continuousA = (typicalA + stallA) * headroom;
  // Every servo starting at once from rest (e.g. scene cut with no speed
  // limit). Lasts ~50–200 ms; covered by bulk capacitance + supply surge rating.
  const allMovingA = servos * profile.moving;
  const worstStallA = servos * profile.stall; // all jammed: never provision for this, fuse it.

  const zones = Math.ceil(servos / zoneSize);
  const perZone = Math.min(zoneSize, servos);
  const zoneContinuousA = continuousA * (perZone / servos);
  const zonePeakA = perZone * profile.moving;

  return {
    servos,
    voltage,
    idleA,
    typicalA,
    continuousA,
    continuousW: continuousA * voltage,
    allMovingA,
    worstStallA,
    zones,
    perZone,
    zoneContinuousA,
    zonePeakA,
    zoneFuseA: roundUpToFuse(zoneContinuousA * 1.25),
    zoneSupplyA: roundUpToSupply(zoneContinuousA),
    // ~ 1000 µF per 10 servos of local bulk capacitance near the servo bus.
    bulkCapUF: Math.ceil(perZone / 10) * 1000,
  };
}

const FUSES = [5, 7.5, 10, 15, 20, 25, 30, 40];
const SUPPLIES = [10, 20, 30, 40, 60];
function roundUpToFuse(a) {
  return FUSES.find((f) => f >= a) ?? Math.ceil(a / 10) * 10;
}
function roundUpToSupply(a) {
  return SUPPLIES.find((f) => f >= a) ?? Math.ceil(a / 10) * 10;
}

/**
 * Live estimate from current servo velocities (deg/s). Current is modelled as
 * idle + (moving - idle) * min(1, |v| / nominalSpeed) — crude, but it shows
 * clearly how the max-speed limit and smoothing reduce the supply load.
 */
export function estimateCurrent(velocities, profile = SERVO_PROFILES[DEFAULT_PROFILE]) {
  let a = 0;
  const span = profile.moving - profile.idle;
  for (let i = 0; i < velocities.length; i++) {
    const r = Math.min(1, Math.abs(velocities[i]) / (profile.nominalSpeed * 0.25));
    a += profile.idle + span * r;
  }
  return a;
}
