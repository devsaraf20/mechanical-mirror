// Person/background segmentation with MediaPipe Tasks (runs fully in the
// browser on the GPU when available, CPU otherwise).
//
// Everything is served locally so the installation works offline: the WASM
// runtime is bundled by Vite from node_modules and the model lives in
// public/models/ (Google's "selfie_segmenter", Apache-2.0). If the local model
// is missing it falls back to Google's model CDN.

import { ImageSegmenter } from '@mediapipe/tasks-vision';
import wasmLoaderPath from '@mediapipe/tasks-vision/vision_wasm_internal.js?url';
import wasmBinaryPath from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url';

const LOCAL_MODEL = `${import.meta.env.BASE_URL}models/selfie_segmenter.tflite`;
const CDN_MODEL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';

export class Segmenter {
  constructor() {
    this.segmenter = null;
    this.loading = null;
    this.status = 'idle';
    this.mask = document.createElement('canvas'); // person = white, background = black
    this.maskCtx = this.mask.getContext('2d');
    this._img = null;
    this._lastTs = -1;
  }

  async load() {
    if (this.segmenter) return true;
    if (this.loading) return this.loading;
    this.status = 'loading model…';
    this.loading = (async () => {
      const fileset = { wasmLoaderPath, wasmBinaryPath };
      const model = (await fetch(LOCAL_MODEL, { method: 'HEAD' }).then((r) => r.ok && !/html/.test(r.headers.get('content-type') || '')).catch(() => false))
        ? LOCAL_MODEL
        : CDN_MODEL;
      const make = (delegate) =>
        ImageSegmenter.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: model, delegate },
          runningMode: 'VIDEO',
          outputCategoryMask: false,
          outputConfidenceMasks: true,
        });
      try {
        this.segmenter = await make('GPU');
      } catch {
        this.segmenter = await make('CPU');
      }
      this.status = 'ready';
      return true;
    })().catch((e) => {
      this.status = 'failed: ' + (e?.message || (e?.type ? `could not load ${e.target?.src || 'runtime'}` : String(e)));
      console.error('[segmenter]', e);
      this.loading = null;
      return false;
    });
    return this.loading;
  }

  /**
   * Run segmentation on a video frame. Returns the mask canvas (same size as
   * the frame) or null when not ready. Call at most once per video frame.
   */
  process(video, w, h, nowMs) {
    if (!this.segmenter) return null;
    // MediaPipe requires strictly increasing timestamps.
    const ts = Math.max(nowMs, this._lastTs + 1);
    this._lastTs = ts;
    const res = this.segmenter.segmentForVideo(video, ts);
    const m = res.confidenceMasks?.[0];
    if (!m) return null;
    const data = m.getAsFloat32Array();
    if (this.mask.width !== m.width || this.mask.height !== m.height) {
      this.mask.width = m.width;
      this.mask.height = m.height;
      this._img = this.maskCtx.createImageData(m.width, m.height);
    }
    const px = this._img.data;
    for (let i = 0, p = 0; i < data.length; i++, p += 4) {
      const v = data[i] * 255;
      px[p] = px[p + 1] = px[p + 2] = v;
      px[p + 3] = 255;
    }
    this.maskCtx.putImageData(this._img, 0, 0);
    res.close?.();
    return this.mask;
  }
}
