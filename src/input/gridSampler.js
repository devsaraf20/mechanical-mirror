// Turns a video frame (or any canvas-drawable image) into a low-resolution
// brightness grid. Each tile gets the *area average* of the pixels it covers
// (drawn at SUPER× the grid size and box-filtered) which is much less noisy
// than letting the browser pick one pixel per tile.

const SUPER = 8;

export class GridSampler {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.cols = 0;
    this.rows = 0;
    // Auto-levels state (slowly adapting black/white points).
    this.lo = 0.1;
    this.hi = 0.9;
  }

  _resize(cols, rows) {
    if (cols === this.cols && rows === this.rows) return;
    this.cols = cols;
    this.rows = rows;
    this.canvas.width = cols * SUPER;
    this.canvas.height = rows * SUPER;
  }

  /**
   * Compute the source crop so the grid's aspect ratio is filled ("cover"),
   * with an optional zoom around the centre.
   */
  static coverRect(sw, sh, cols, rows, zoom = 1) {
    const target = cols / rows;
    let w = sw;
    let h = sw / target;
    if (h > sh) {
      h = sh;
      w = sh * target;
    }
    w /= zoom;
    h /= zoom;
    return { x: (sw - w) / 2, y: (sh - h) / 2, w, h };
  }

  /**
   * @param {CanvasImageSource} src
   * @param {number} sw source width
   * @param {number} sh source height
   * @param {Float32Array} out brightness grid (cols*rows) 0..1, row-major, row 0 = top
   * @param {object} o {mirror, zoom, autoLevels, blur}
   */
  sample(src, sw, sh, cols, rows, out, o = {}) {
    if (!sw || !sh) return false;
    this._resize(cols, rows);
    const { canvas: c, ctx } = this;
    const r = GridSampler.coverRect(sw, sh, cols, rows, o.zoom || 1);
    ctx.save();
    ctx.filter = o.blur ? `blur(${o.blur}px)` : 'none';
    if (o.mirror) {
      ctx.translate(c.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
    ctx.restore();

    const px = ctx.getImageData(0, 0, c.width, c.height).data;
    const W = c.width;
    const inv = 1 / (SUPER * SUPER * 255);
    for (let gy = 0; gy < rows; gy++) {
      for (let gx = 0; gx < cols; gx++) {
        let sum = 0;
        for (let y = 0; y < SUPER; y++) {
          let p = ((gy * SUPER + y) * W + gx * SUPER) * 4;
          for (let x = 0; x < SUPER; x++, p += 4) {
            // Rec. 709 luma on (approximately) linearised values.
            sum += 0.2126 * px[p] + 0.7152 * px[p + 1] + 0.0722 * px[p + 2];
          }
        }
        out[gy * cols + gx] = sum * inv;
      }
    }

    if (o.autoLevels) this._autoLevels(out, o.autoLevelsSpeed ?? 0.05);
    return true;
  }

  /** Stretch the 5th–95th percentile range to 0..1 with slow adaptation. */
  _autoLevels(g, speed) {
    const s = Float32Array.from(g).sort();
    const lo = s[Math.floor(s.length * 0.05)];
    const hi = s[Math.min(s.length - 1, Math.floor(s.length * 0.95))];
    this.lo += (lo - this.lo) * speed;
    this.hi += (hi - this.hi) * speed;
    const span = Math.max(0.08, this.hi - this.lo);
    for (let i = 0; i < g.length; i++) g[i] = Math.min(1, Math.max(0, (g[i] - this.lo) / span));
  }
}
