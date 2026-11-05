// Motion planner: turns noisy per-frame target angles into smooth, rate-limited
// servo commands.
//
// Three stages per tile, evaluated every tick with the real elapsed time dt:
//
//  1. Deadband   – ignore target changes smaller than `deadband` degrees so
//                  camera noise does not make servos buzz.
//  2. Smoothing  – first-order low-pass with time constant `smoothing` (s):
//                  filtered += (target - filtered) * (1 - exp(-dt / tau))
//                  This is frame-rate independent.
//  3. Limiting   – the commanded angle chases the filtered value with
//                  |velocity| <= maxSpeed (deg/s) and
//                  |acceleration| <= maxAccel (deg/s²).
//                  The acceleration limit uses a stopping-distance check so the
//                  servo decelerates into the target instead of overshooting.
//
// The ESP32 firmware applies its own (looser) slew limit as a second line of
// defence, so a misbehaving client can never slam the servos.

export const DEFAULT_MOTION = {
  smoothing: 0.12, // s, low-pass time constant (0 = off)
  maxSpeed: 180, // deg/s  (hobby micro servos manage ~500-600 deg/s unloaded)
  maxAccel: 1500, // deg/s² (0 = unlimited)
  deadband: 0.4, // deg
};

export class MotionPlanner {
  constructor(count, initialAngle = 0) {
    this.resize(count, initialAngle);
  }

  resize(count, initialAngle = 0) {
    this.count = count;
    this.target = new Float32Array(count).fill(initialAngle);
    this.filtered = new Float32Array(count).fill(initialAngle);
    this.angle = new Float32Array(count).fill(initialAngle);
    this.velocity = new Float32Array(count);
  }

  /** Set the desired angles (length must match count). */
  setTargets(angles, deadband = DEFAULT_MOTION.deadband) {
    const t = this.target;
    for (let i = 0; i < this.count; i++) {
      const a = angles[i];
      if (Math.abs(a - t[i]) >= deadband) t[i] = a;
    }
  }

  /** Jump everything to a pose immediately (e.g. after a grid resize). */
  snap(angle = 0) {
    this.target.fill(angle);
    this.filtered.fill(angle);
    this.angle.fill(angle);
    this.velocity.fill(0);
  }

  /**
   * Advance by dt seconds. Returns the commanded angles (Float32Array view,
   * do not keep a reference across ticks if you need a snapshot).
   */
  step(dt, p = DEFAULT_MOTION) {
    if (!(dt > 0)) return this.angle;
    dt = Math.min(dt, 0.1); // tab was in background: don't take a giant step
    const k = p.smoothing > 0 ? 1 - Math.exp(-dt / p.smoothing) : 1;
    const vmax = p.maxSpeed > 0 ? p.maxSpeed : Infinity;
    const amax = p.maxAccel > 0 ? p.maxAccel : Infinity;

    for (let i = 0; i < this.count; i++) {
      const f = (this.filtered[i] += (this.target[i] - this.filtered[i]) * k);
      const pos = this.angle[i];
      let v = this.velocity[i];
      const err = f - pos;

      // Desired velocity: go full speed, but no faster than we can stop from
      // (v² = 2·a·d) and no faster than reaches the target this tick.
      let vDes = Math.sign(err) * Math.min(vmax, Math.abs(err) / dt);
      if (amax !== Infinity) {
        // Discrete-time stopping speed: the largest v from which repeated
        // decelerations of amax·dt per tick stop exactly at the target.
        const adt = amax * dt;
        const vStop = adt * (Math.sqrt(0.25 + (2 * Math.abs(err)) / (adt * dt)) - 0.5);
        vDes = Math.sign(err) * Math.min(Math.abs(vDes), vStop);
      }

      const dv = vDes - v;
      const dvMax = amax * dt;
      v += Math.abs(dv) > dvMax ? Math.sign(dv) * dvMax : dv;

      let next = pos + v * dt;
      // Never cross the target because of the discrete step.
      if ((err > 0 && next > f) || (err < 0 && next < f)) {
        next = f;
        v = 0;
      }
      this.angle[i] = next;
      this.velocity[i] = v;
    }
    return this.angle;
  }

  /** Per-tile velocity (deg/s) – used for the current-draw estimate. */
  speeds() {
    return this.velocity;
  }
}
