// Minimal OSC 1.0 encoder/decoder (no dependencies). Works in the browser and
// in Node. Supports the types the Physical Bridge format uses: i, f, s, b.

function pad4(n) {
  return (n + 3) & ~3;
}

function strBytes(s) {
  const raw = new TextEncoder().encode(s);
  const out = new Uint8Array(pad4(raw.length + 1)); // NUL terminated + padding
  out.set(raw);
  return out;
}

/**
 * Encode one OSC message.
 * @param {string} address e.g. "/pb/frame"
 * @param {Array<{type:'i'|'f'|'s'|'b', value:any}>} args
 * @returns {Uint8Array}
 */
export function encodeMessage(address, args = []) {
  const parts = [strBytes(address), strBytes(',' + args.map((a) => a.type).join(''))];
  for (const a of args) {
    if (a.type === 'i' || a.type === 'f') {
      const b = new Uint8Array(4);
      const dv = new DataView(b.buffer);
      if (a.type === 'i') dv.setInt32(0, a.value | 0, false);
      else dv.setFloat32(0, a.value, false);
      parts.push(b);
    } else if (a.type === 's') {
      parts.push(strBytes(String(a.value)));
    } else if (a.type === 'b') {
      const data = a.value instanceof Uint8Array ? a.value : new Uint8Array(a.value);
      const b = new Uint8Array(4 + pad4(data.length));
      new DataView(b.buffer).setInt32(0, data.length, false);
      b.set(data, 4);
      parts.push(b);
    } else {
      throw new Error(`Unsupported OSC type ${a.type}`);
    }
  }
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function readStr(buf, o) {
  let end = o;
  while (end < buf.length && buf[end] !== 0) end++;
  const s = new TextDecoder().decode(buf.subarray(o, end));
  return [s, pad4(end + 1)];
}

/** Decode one OSC message (bundles not supported). */
export function decodeMessage(bytes) {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let [address, o] = readStr(buf, 0);
  let tags;
  [tags, o] = readStr(buf, o);
  const args = [];
  for (const t of tags.slice(1)) {
    if (t === 'i') {
      args.push(dv.getInt32(o, false));
      o += 4;
    } else if (t === 'f') {
      args.push(dv.getFloat32(o, false));
      o += 4;
    } else if (t === 's') {
      let s;
      [s, o] = readStr(buf, o);
      args.push(s);
    } else if (t === 'b') {
      const n = dv.getInt32(o, false);
      args.push(buf.slice(o + 4, o + 4 + n));
      o += 4 + pad4(n);
    } else throw new Error(`Unsupported OSC type ${t}`);
  }
  return { address, types: tags.slice(1), args };
}
