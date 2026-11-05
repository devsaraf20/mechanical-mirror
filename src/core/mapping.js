// Brightness → tilt-angle mapping.
//
// Brightness is a 0..1 value per tile (0 = black, 1 = white). The physical
// tile is lit from above, so tilting it UP (positive angle, top edge away from
// the viewer) catches more light and reads brighter; tilting it DOWN puts its
// face in shadow and reads darker. The mapping is therefore:
//
//   darkAngle  <- brightness 0
//   brightAngle <- brightness 1
//
// Both ends are adjustable so the range can be matched to the real lighting
// and to the mechanical limits of the build.

export const DEFAULT_MAPPING = {
  darkAngle: -30, // degrees, tilt for black
  brightAngle: 25, // degrees, tilt for white
  gamma: 1.0, // >1 pushes mid-tones darker, <1 lighter
  contrast: 1.0, // around 0.5 grey
  invert: false,
  quantize: 0, // 0 = continuous, otherwise number of discrete levels
  limitMin: -45, // hard mechanical clamp (never exceeded)
  limitMax: 45,
};

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Apply contrast / gamma / invert / quantize to one brightness value. */
export function shapeBrightness(b, m = DEFAULT_MAPPING) {
  let v = clamp(b, 0, 1);
  if (m.invert) v = 1 - v;
  if (m.contrast !== 1) v = clamp((v - 0.5) * m.contrast + 0.5, 0, 1);
  if (m.gamma !== 1) v = Math.pow(v, m.gamma);
  if (m.quantize && m.quantize > 1) {
    const n = m.quantize - 1;
    v = Math.round(v * n) / n;
  }
  return v;
}

/** Map one brightness value (0..1) to a tilt angle in degrees. */
export function brightnessToAngle(b, m = DEFAULT_MAPPING) {
  const v = shapeBrightness(b, m);
  const a = m.darkAngle + (m.brightAngle - m.darkAngle) * v;
  return clamp(a, m.limitMin, m.limitMax);
}

/** Map a whole grid (Float32Array of brightness) into `out` angles. */
export function mapGrid(brightness, out, m = DEFAULT_MAPPING) {
  for (let i = 0; i < brightness.length; i++) out[i] = brightnessToAngle(brightness[i], m);
  return out;
}

/** Inverse mapping (used by the simulator for the "flat" preview). */
export function angleToBrightness(a, m = DEFAULT_MAPPING) {
  const span = m.brightAngle - m.darkAngle;
  if (span === 0) return 0.5;
  return clamp((a - m.darkAngle) / span, 0, 1);
}
