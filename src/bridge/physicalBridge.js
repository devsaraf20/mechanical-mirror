// Physical Bridge format — see docs/physical-bridge.md for the full spec.
//
// Two encodings of the same data:
//   json : WebSocket text message   {"pb":1,"type":"frame",...}
//   osc  : OSC 1.0 packet           /pb/frame ,iiib seq cols rows blob(int16 BE, 0.1°)
//
// The browser cannot send UDP, so OSC packets travel as binary WebSocket
// messages, either straight to the ESP32 (which accepts OSC over WebSocket)
// or to bridge/relay.mjs which forwards them as UDP datagrams.

import { encodeMessage, decodeMessage } from './osc.js';

export const PB_VERSION = 1;
export const OSC_FRAME = '/pb/frame';
export const OSC_HELLO = '/pb/hello';
export const OSC_ENABLE = '/pb/enable';
export const OSC_HOME = '/pb/home';

/** Angles (deg) → int16 big-endian tenths of a degree. */
export function packAngles(angles) {
  const out = new Uint8Array(angles.length * 2);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < angles.length; i++) {
    const d = Math.max(-32768, Math.min(32767, Math.round(angles[i] * 10)));
    dv.setInt16(i * 2, d, false);
  }
  return out;
}

export function unpackAngles(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Float64Array(bytes.byteLength / 2);
  for (let i = 0; i < out.length; i++) out[i] = dv.getInt16(i * 2, false) / 10;
  return out;
}

export function encodeFrameJSON({ seq, cols, rows, angles, t = Date.now() }) {
  return JSON.stringify({
    pb: PB_VERSION,
    type: 'frame',
    seq,
    t,
    cols,
    rows,
    order: 'row-major',
    unit: 'deg',
    angles: Array.from(angles, (a) => Math.round(a * 10) / 10),
  });
}

export function encodeFrameOSC({ seq, cols, rows, angles }) {
  return encodeMessage(OSC_FRAME, [
    { type: 'i', value: seq },
    { type: 'i', value: cols },
    { type: 'i', value: rows },
    { type: 'b', value: packAngles(angles) },
  ]);
}

export function encodeControlOSC(kind, value) {
  if (kind === 'enable') return encodeMessage(OSC_ENABLE, [{ type: 'i', value: value ? 1 : 0 }]);
  if (kind === 'home') return encodeMessage(OSC_HOME, []);
  if (kind === 'hello') return encodeMessage(OSC_HELLO, [{ type: 's', value: String(value ?? 'mechanical-mirror') }]);
  throw new Error(`unknown control ${kind}`);
}

export function encodeControlJSON(kind, value) {
  return JSON.stringify({ pb: PB_VERSION, type: kind, value });
}

/** Parse either encoding back into {type, ...}. Used by the relay and tests. */
export function decodeAny(data) {
  if (typeof data === 'string') {
    const m = JSON.parse(data);
    if (m.pb !== PB_VERSION) throw new Error('not a Physical Bridge v1 message');
    return m;
  }
  const msg = decodeMessage(data);
  if (msg.address === OSC_FRAME) {
    const [seq, cols, rows, blob] = msg.args;
    return { pb: PB_VERSION, type: 'frame', seq, cols, rows, angles: Array.from(unpackAngles(blob)) };
  }
  if (msg.address === OSC_ENABLE) return { pb: PB_VERSION, type: 'enable', value: !!msg.args[0] };
  if (msg.address === OSC_HOME) return { pb: PB_VERSION, type: 'home' };
  if (msg.address === OSC_HELLO) return { pb: PB_VERSION, type: 'hello', value: msg.args[0] };
  return { pb: PB_VERSION, type: 'unknown', address: msg.address };
}

/**
 * WebSocket client with auto-reconnect and rate limiting.
 * Sends only when angles changed by more than `minDelta` or `keepAlive` ms
 * passed (so the ESP32 failsafe sees a steady heartbeat).
 */
export class PhysicalBridgeClient {
  constructor() {
    this.url = '';
    this.format = 'osc';
    this.rate = 30; // Hz
    this.minDelta = 0.2; // deg
    this.keepAlive = 500; // ms
    this.ws = null;
    this.status = 'disconnected';
    this.seq = 0;
    this.sent = 0;
    this.lastSendAt = 0;
    this.lastAngles = null;
    this.onStatus = () => {};
    this._wantOpen = false;
    this._retry = null;
  }

  connect(url, format = this.format) {
    this.disconnect();
    this.url = url;
    this.format = format;
    this._wantOpen = true;
    this._open();
  }

  disconnect() {
    this._wantOpen = false;
    clearTimeout(this._retry);
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this._setStatus('disconnected');
  }

  _setStatus(s) {
    this.status = s;
    this.onStatus(s);
  }

  _open() {
    let ws;
    try {
      ws = new WebSocket(this.url);
    } catch (e) {
      this._setStatus('error: ' + e.message);
      return;
    }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    this._setStatus('connecting');
    ws.onopen = () => {
      this._setStatus('connected');
      this.lastAngles = null;
      this._sendRaw(this.format === 'osc' ? encodeControlOSC('hello') : encodeControlJSON('hello', 'mechanical-mirror'));
    };
    ws.onerror = () => this._setStatus('error');
    ws.onclose = () => {
      this.ws = null;
      if (this._wantOpen) {
        this._setStatus('reconnecting');
        this._retry = setTimeout(() => this._open(), 1500);
      }
    };
  }

  get connected() {
    return this.ws && this.ws.readyState === 1;
  }

  _sendRaw(payload) {
    if (!this.connected) return false;
    // Drop frames instead of queueing if the link is congested.
    if (this.ws.bufferedAmount > 64 * 1024) return false;
    this.ws.send(payload);
    return true;
  }

  sendControl(kind, value) {
    return this._sendRaw(this.format === 'osc' ? encodeControlOSC(kind, value) : encodeControlJSON(kind, value));
  }

  /** Call every animation frame; internally throttled to `rate`. */
  maybeSend(now, cols, rows, angles) {
    if (!this.connected) return false;
    if (now - this.lastSendAt < 1000 / this.rate) return false;
    let changed = !this.lastAngles || this.lastAngles.length !== angles.length;
    if (!changed) {
      for (let i = 0; i < angles.length; i++) {
        if (Math.abs(angles[i] - this.lastAngles[i]) > this.minDelta) {
          changed = true;
          break;
        }
      }
    }
    if (!changed && now - this.lastSendAt < this.keepAlive) return false;

    const frame = { seq: (this.seq = (this.seq + 1) | 0), cols, rows, angles };
    const ok = this._sendRaw(this.format === 'osc' ? encodeFrameOSC(frame) : encodeFrameJSON(frame));
    if (ok) {
      this.lastSendAt = now;
      this.lastAngles = Float32Array.from(angles);
      this.sent++;
    }
    return ok;
  }
}
