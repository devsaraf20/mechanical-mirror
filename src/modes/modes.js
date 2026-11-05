// Content modes. Each mode fills a brightness grid (Float32Array, 0..1,
// row-major, row 0 = top) once per frame. The rest of the pipeline
// (mapping → motion planner → sim/bridge) is shared.

import { textColumns, GLYPH_H } from './font5x7.js';

export const MODE_NAMES = ['mirror', 'silhouette', 'wave', 'text'];

/** Webcam brightness, straight through. */
export function mirrorMode(ctx, out, p) {
  const f = ctx.camera.frame(ctx.time);
  ctx.sampler.sample(f.src, f.w, f.h, ctx.cols, ctx.rows, out, {
    mirror: p.mirrorImage,
    zoom: p.zoom,
    autoLevels: p.autoLevels,
    blur: p.blur,
  });
  return f;
}

/**
 * Body segmentation. "solid": person one tone, background the other.
 * "shaded": person shows camera brightness, background flat.
 */
export function silhouetteMode(ctx, out, p) {
  const f = ctx.camera.frame(ctx.time);
  const seg = ctx.segmenter;
  if (seg.status === 'idle') seg.load();
  const mask = seg.segmenter ? seg.process(f.src, f.w, f.h, ctx.time * 1000) : null;
  if (!mask) {
    // Model still loading — show plain mirror so the grid isn't frozen.
    mirrorMode(ctx, out, p);
    return f;
  }
  const opts = { mirror: p.mirrorImage, zoom: p.zoom, blur: p.blur };
  const m = ctx.scratch(out.length);
  ctx.maskSampler.sample(mask, mask.width, mask.height, ctx.cols, ctx.rows, m, opts);
  const thr = p.silhouetteThreshold;
  const soft = Math.max(0.01, p.silhouetteSoftness);
  const person = p.silhouetteInvert ? 1 : 0;
  const bg = 1 - person;
  if (p.silhouetteStyle === 'shaded') {
    ctx.sampler.sample(f.src, f.w, f.h, ctx.cols, ctx.rows, out, { ...opts, autoLevels: p.autoLevels });
  }
  for (let i = 0; i < out.length; i++) {
    const a = smoothstep(thr - soft, thr + soft, m[i]); // 1 = person
    const fg = p.silhouetteStyle === 'shaded' ? out[i] : person;
    out[i] = fg * a + bg * (1 - a);
  }
  return f;
}

/** Procedural waves. Wavelength in tiles, speed in cycles per second. */
export function waveMode(ctx, out, p) {
  const { cols, rows, time: t } = ctx;
  const k = (Math.PI * 2) / Math.max(0.5, p.waveLength);
  const w = Math.PI * 2 * p.waveSpeed * t;
  const cx = (cols - 1) / 2;
  const cy = (rows - 1) / 2;
  const a = p.waveAngle * (Math.PI / 180);
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const X = x - cx;
      const Y = y - cy;
      let v;
      switch (p.wavePattern) {
        case 'linear':
          v = Math.sin((X * dx + Y * dy) * k - w);
          break;
        case 'ripple':
          v = Math.sin(Math.hypot(X, Y) * k - w);
          break;
        case 'interference': {
          const ox = cols * 0.3;
          v = 0.5 * (Math.sin(Math.hypot(X - ox, Y) * k - w) + Math.sin(Math.hypot(X + ox, Y) * k - w));
          break;
        }
        case 'spiral':
          v = Math.sin(Math.hypot(X, Y) * k + Math.atan2(Y, X) * 2 - w);
          break;
        case 'plasma':
          v =
            (Math.sin(X * k * 0.7 + w) +
              Math.sin((Y * k * 0.9 - w * 0.7)) +
              Math.sin((X + Y) * k * 0.5 + w * 0.5) +
              Math.sin(Math.hypot(X + Math.sin(w * 0.3) * cx, Y + Math.cos(w * 0.4) * cy) * k)) /
            4;
          break;
        case 'breathe':
        default:
          v = Math.sin(w);
      }
      out[y * cols + x] = 0.5 + 0.5 * v * p.waveAmplitude;
    }
  }
}

/**
 * Scrolling 5×7 pixel text. Sub-tile scroll positions are rendered as
 * intermediate tilts so motion stays continuous instead of stepping.
 */
export function textMode(ctx, out, p, state) {
  const { cols, rows, time: t } = ctx;
  if (state.text !== p.text) {
    state.text = p.text;
    state.core = textColumns(p.text).slice(0, -1); // drop trailing gap
    state.padded = textColumns(p.text + '  ');
  }
  const maxScale = Math.max(1, Math.floor(rows / GLYPH_H));
  const scale = p.textScale > 0 ? Math.min(p.textScale, maxScale) : maxScale;
  const fits = state.core.length * scale <= cols;
  const colsBits = fits ? state.core : state.padded;
  const len = colsBits.length * scale;
  // Static & centred when it fits, otherwise an endless right-to-left scroll.
  const offset = fits ? -Math.floor((cols - len) / 2) : (t * p.textSpeed) % len;
  const top = Math.floor((rows - GLYPH_H * scale) / 2);
  const bitAt = (sx, sy) => {
    const gy = Math.floor((sy - top) / scale);
    if (gy < 0 || gy >= GLYPH_H) return 0;
    if (fits && (sx < 0 || sx >= len)) return 0;
    const i = ((Math.floor(sx / scale) % colsBits.length) + colsBits.length) % colsBits.length;
    return (colsBits[i] >> gy) & 1;
  };
  const fo = Math.floor(offset);
  const fr = offset - fo;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const a = bitAt(x + fo, y);
      const b = bitAt(x + fo + 1, y);
      const v = a * (1 - fr) + b * fr;
      out[y * cols + x] = p.textInvert ? v : 1 - v; // default: dark text on bright field
    }
  }
}

function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
