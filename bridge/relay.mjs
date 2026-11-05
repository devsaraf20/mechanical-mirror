#!/usr/bin/env node
// Physical Bridge relay: browser (WebSocket) → OSC over UDP.
//
// Browsers cannot send UDP, so the web app connects here over WebSocket and
// this process forwards every frame as an OSC datagram to one or more targets
// (the ESP32, TouchDesigner, Max, a second mirror ...).
//
//   Binary WS message  = already an OSC packet → forwarded byte-for-byte.
//   Text WS message    = Physical Bridge JSON  → converted to OSC first.
//
// Usage:
//   node bridge/relay.mjs --ws 8787 --osc 192.168.1.50:9000 [--osc host:port ...] [--verbose]
//
// Point the web app's bridge URL at ws://<this-machine>:8787.

import { WebSocketServer } from 'ws';
import dgram from 'node:dgram';
import { decodeAny, encodeFrameOSC, encodeControlOSC } from '../src/bridge/physicalBridge.js';

const args = process.argv.slice(2);
let wsPort = 8787;
const targets = [];
let verbose = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--ws') wsPort = Number(args[++i]);
  else if (args[i] === '--osc') {
    const [host, port] = args[++i].split(':');
    targets.push({ host, port: Number(port || 9000) });
  } else if (args[i] === '--verbose' || args[i] === '-v') verbose = true;
  else if (args[i] === '--help' || args[i] === '-h') {
    console.log('node bridge/relay.mjs --ws 8787 --osc <host:port> [--osc <host:port>] [--verbose]');
    process.exit(0);
  }
}
if (!targets.length) targets.push({ host: '127.0.0.1', port: 9000 });

const udp = dgram.createSocket('udp4');
udp.on('error', (e) => console.error('[udp]', e.message));
udp.bind(() => {
  try {
    udp.setBroadcast(true);
  } catch {}
});

function forward(buf) {
  for (const t of targets) udp.send(buf, t.port, t.host);
}

function toOSC(msg) {
  if (msg.type === 'frame') return encodeFrameOSC(msg);
  if (msg.type === 'enable') return encodeControlOSC('enable', msg.value);
  if (msg.type === 'home') return encodeControlOSC('home');
  if (msg.type === 'hello') return encodeControlOSC('hello', msg.value);
  return null;
}

const wss = new WebSocketServer({ port: wsPort });
let frames = 0;
wss.on('connection', (ws, req) => {
  console.log(`[ws] client ${req.socket.remoteAddress} connected`);
  ws.on('message', (data, isBinary) => {
    try {
      let out;
      if (isBinary) {
        out = Buffer.from(data);
        if (verbose) console.log(decodeAny(new Uint8Array(out)));
      } else {
        const msg = decodeAny(data.toString());
        if (verbose) console.log(msg.type, msg.seq ?? '', msg.cols ? `${msg.cols}x${msg.rows}` : '');
        const osc = toOSC(msg);
        if (!osc) return;
        out = Buffer.from(osc);
      }
      forward(out);
      frames++;
    } catch (e) {
      console.warn('[ws] bad message:', e.message);
    }
  });
  ws.on('close', () => console.log('[ws] client disconnected'));
});

setInterval(() => {
  if (frames) process.stdout.write(`\r[relay] ${frames} packets forwarded   `);
}, 1000).unref();

console.log(`[relay] ws://0.0.0.0:${wsPort}  →  OSC/UDP ${targets.map((t) => `${t.host}:${t.port}`).join(', ')}`);
