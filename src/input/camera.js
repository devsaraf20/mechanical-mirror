// Webcam capture with a synthetic fallback so the app (and the simulator)
// stay usable without a camera, e.g. on a headless build machine.

export class Camera {
  constructor() {
    this.video = document.createElement('video');
    this.video.playsInline = true;
    this.video.muted = true;
    this.stream = null;
    this.ready = false;
    this.error = null;
    this.synthetic = new SyntheticSource();
  }

  async start(deviceId) {
    this.stop();
    if (!navigator.mediaDevices?.getUserMedia) {
      this.error = 'getUserMedia not available (needs https or localhost)';
      return false;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user',
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        },
        audio: false,
      });
      this.video.srcObject = this.stream;
      await this.video.play();
      this.ready = true;
      this.error = null;
      return true;
    } catch (e) {
      this.error = e.message || String(e);
      this.ready = false;
      return false;
    }
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.ready = false;
  }

  static async listDevices() {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      return all.filter((d) => d.kind === 'videoinput');
    } catch {
      return [];
    }
  }

  /** Current frame source + dimensions; falls back to the synthetic scene. */
  frame(t) {
    if (this.ready && this.video.readyState >= 2 && this.video.videoWidth) {
      return { src: this.video, w: this.video.videoWidth, h: this.video.videoHeight, live: true };
    }
    this.synthetic.draw(t);
    return { src: this.synthetic.canvas, w: this.synthetic.canvas.width, h: this.synthetic.canvas.height, live: false };
  }
}

/** A soft "head and shoulders" figure that sways — stands in for a person. */
export class SyntheticSource {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 320;
    this.canvas.height = 240;
    this.ctx = this.canvas.getContext('2d');
  }

  draw(t) {
    const { ctx, canvas: c } = this;
    const g = ctx.createLinearGradient(0, 0, c.width, c.height);
    g.addColorStop(0, '#d8d8d8');
    g.addColorStop(1, '#8a8a8a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, c.width, c.height);
    const x = c.width / 2 + Math.sin(t * 0.7) * 50;
    const y = c.height * 0.42 + Math.sin(t * 1.3) * 8;
    ctx.fillStyle = '#2a2a2a';
    ctx.beginPath();
    ctx.ellipse(x, c.height + 20, 105, 95, 0, 0, Math.PI * 2); // shoulders
    ctx.fill();
    ctx.fillStyle = '#5a5a5a';
    ctx.beginPath();
    ctx.ellipse(x, y, 42, 54, Math.sin(t * 0.9) * 0.15, 0, Math.PI * 2); // head
    ctx.fill();
    ctx.fillStyle = '#c9c9c9';
    ctx.beginPath(); // a raised hand
    ctx.arc(x + 95 + Math.sin(t * 3) * 15, y - 30 + Math.cos(t * 3) * 10, 18, 0, Math.PI * 2);
    ctx.fill();
  }
}
