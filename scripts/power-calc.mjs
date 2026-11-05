#!/usr/bin/env node
// Power-supply sizing for N hobby servos.
//   npm run power -- --servos 144 --servo "MG90S (5V)" --duty 0.6 --zone 48
import { sizeSupply, SERVO_PROFILES, DEFAULT_PROFILE } from '../src/core/power.js';

const a = process.argv.slice(2);
const opt = (k, d) => {
  const i = a.indexOf('--' + k);
  return i >= 0 ? a[i + 1] : d;
};
if (a.includes('--help')) {
  console.log(`--servos N  --servo "<profile>"  --duty 0..1  --stall 0..1  --headroom 1.3  --volts 5  --zone 48
profiles: ${Object.keys(SERVO_PROFILES).join(', ')}`);
  process.exit(0);
}
const name = opt('servo', DEFAULT_PROFILE);
const profile = SERVO_PROFILES[name];
if (!profile) throw new Error(`unknown servo "${name}"`);
const r = sizeSupply({
  servos: Number(opt('servos', 144)),
  profile,
  duty: Number(opt('duty', 0.6)),
  stallFraction: Number(opt('stall', 0.05)),
  headroom: Number(opt('headroom', 1.3)),
  voltage: Number(opt('volts', 5)),
  zoneSize: Number(opt('zone', 48)),
});
const f = (x) => x.toFixed(1).padStart(7);
console.log(`
Servo power estimate — ${r.servos} × ${name}
  (idle ${profile.idle * 1000} mA, moving ${profile.moving * 1000} mA, stall ${profile.stall * 1000} mA each — MEASURE YOUR OWN)

  all idle (holding)            ${f(r.idleA)} A
  typical (${Math.round(Number(opt('duty', 0.6)) * 100)} % moving)          ${f(r.typicalA)} A
  design continuous             ${f(r.continuousA)} A  (typical + some stalled, × headroom)
                                 = ${r.continuousW.toFixed(0)} W @ ${r.voltage} V
  every servo starting at once  ${f(r.allMovingA)} A  (short transient)
  every servo stalled           ${f(r.worstStallA)} A  (fault — fuses must open)

Split into ${r.zones} zone(s) of ≤ ${r.perZone} servos:
  per zone continuous           ${f(r.zoneContinuousA)} A
  per zone transient            ${f(r.zonePeakA)} A
  → supply per zone             ${String(r.zoneSupplyA).padStart(5)} A at ${r.voltage} V
  → fuse per zone (slow-blow)   ${String(r.zoneFuseA).padStart(5)} A
  → bulk capacitance per zone   ≥ ${r.bulkCapUF} µF (low-ESR, ≥ 10 V)
`);
