// Small 2D debug views in the HUD.

import { GridSampler } from '../input/gridSampler.js';

/** Camera frame with the crop region outlined and the tile grid overlaid. */
export function drawInput(canvas, input, p) {
  const g = canvas.getContext('2d');
  const { width: W, height: H } = canvas;
  const r = GridSampler.coverRect(input.w, input.h, p.cols, p.rows, p.zoom);
  g.save();
  if (p.mirrorImage) {
    g.translate(W, 0);
    g.scale(-1, 1);
  }
  g.drawImage(input.src, r.x, r.y, r.w, r.h, 0, 0, W, H);
  g.restore();
  g.strokeStyle = 'rgba(226,178,107,0.35)';
  g.lineWidth = 1;
  g.beginPath();
  for (let x = 1; x < p.cols; x++) {
    const px = Math.round((x * W) / p.cols) + 0.5;
    g.moveTo(px, 0);
    g.lineTo(px, H);
  }
  for (let y = 1; y < p.rows; y++) {
    const py = Math.round((y * H) / p.rows) + 0.5;
    g.moveTo(0, py);
    g.lineTo(W, py);
  }
  g.stroke();
}

export function drawGrid(canvas, values, cols, rows) {
  const g = canvas.getContext('2d');
  const cw = canvas.width / cols;
  const ch = canvas.height / rows;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const v = Math.round(values[y * cols + x] * 255);
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(Math.floor(x * cw), Math.floor(y * ch), Math.ceil(cw), Math.ceil(ch));
    }
  }
}

/** Diverging colour map: blue = tilted down, orange = tilted up. */
export function drawAngles(canvas, angles, cols, rows, p) {
  const g = canvas.getContext('2d');
  const cw = canvas.width / cols;
  const ch = canvas.height / rows;
  const span = Math.max(1, Math.abs(p.limitMin), Math.abs(p.limitMax));
  g.fillStyle = '#000';
  g.fillRect(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const a = angles[y * cols + x] / span; // -1..1
      const t = Math.min(1, Math.abs(a));
      const [r, gg, b] = a >= 0 ? [226, 160, 80] : [90, 150, 235];
      g.fillStyle = `rgb(${Math.round(30 + (r - 30) * t)},${Math.round(30 + (gg - 30) * t)},${Math.round(34 + (b - 34) * t)})`;
      g.fillRect(Math.floor(x * cw) + 1, Math.floor(y * ch) + 1, Math.ceil(cw) - 2, Math.ceil(ch) - 2);
    }
  }
}
