# Physical Bridge format (v1)

The web app talks to hardware through a small, transport-agnostic message
format called the **Physical Bridge**. One frame carries the tilt angle of
every tile. The same data has two encodings:

| Encoding | Transport | Used by |
|---|---|---|
| **OSC** (`/pb/frame`) | UDP datagram, or a *binary* WebSocket message carrying the raw OSC packet | ESP32 firmware, TouchDesigner, Max/MSP, Pure Data, `bridge/relay.mjs` |
| **JSON** | WebSocket *text* message | Your own software (Python, Unity, Node), the relay (converts to OSC) |

The firmware only parses OSC. JSON is there for other software that's easier
to write against JSON. If you want JSON to reach the ESP32, send it through the
relay, which converts it.

## Conventions

- **Angles** are tilt in degrees relative to the neutral pose (0° = tile flat
  and parallel to the backboard).
  **Positive = top edge tilts away from the viewer**, so the face turns up
  toward the light and reads *brighter*. Negative = face turns down and reads
  *darker*.
- **Order** is row-major. Row 0 is the top row and column 0 is the left column
  *as seen by the viewer standing in front of the mirror*.
  Index = `row * cols + col`.
- Mapping from angles to servo pulses (direction, trim, pulse width) is the
  **receiver's** job. The sender never knows about servo calibration.
- Senders should rate-limit motion themselves. Receivers also enforce their own
  slew limit and hard clamps.

## OSC messages

All integers are big-endian int32 (standard OSC).

| Address | Type tags | Arguments |
|---|---|---|
| `/pb/frame` | `,iiib` | `seq`, `cols`, `rows`, `blob` = `cols*rows` × **int16 big-endian, tenths of a degree** (e.g. `-123` = −12.3°) |
| `/pb/enable` | `,i` | `1` = start driving servos (staggered wake), `0` = all outputs off (servos go limp) |
| `/pb/home` | `,` | All tiles to 0° |
| `/pb/hello` | `,s` | Client name. Informational only. |

A 12×12 `/pb/frame` packet is 12 + 8 + 12 + 4 + 288 = **324 bytes**, which
fits easily in one UDP datagram. The firmware buffer allows grids up to about
44×44 (4 KB).

Byte layout of the header, which the firmware parser relies on:

```
2f 70 62 2f 66 72 61 6d 65 00 00 00   "/pb/frame" + pad
2c 69 69 69 62 00 00 00               ",iiib" + pad
<seq:i32> <cols:i32> <rows:i32> <bloblen:i32> <int16 BE × N> <pad to 4>
```

## JSON messages

```json
{"pb":1,"type":"frame","seq":812,"t":1730790000000,"cols":12,"rows":12,
 "order":"row-major","unit":"deg","angles":[-12.3, 4.0, 18.5, ...]}
{"pb":1,"type":"enable","value":true}
{"pb":1,"type":"home"}
{"pb":1,"type":"hello","value":"mechanical-mirror"}
```

`t` is the sender's wall clock in ms. It's optional. `angles` are rounded to
0.1°.

## Timing and liveness

- The web app sends at up to `rate` Hz (default 30). It only sends when any
  angle changed by more than 0.2°, and at least every 500 ms as a heartbeat.
- `seq` increments per frame (wrapping int32). Receivers may drop frames whose
  `seq` is older than the last one they applied. Over UDP that guards against
  reordering. The firmware doesn't need to, because its slew limiter smooths
  everything anyway.
- **Failsafe** (firmware): if no frame arrives for 2 s, the tiles ease back to
  0°. After 2 min the outputs switch off.

## Topologies

```
Browser ──WS binary OSC──▶ ESP32 :81                      (direct, no extra software)
Browser ──WS (OSC/JSON)──▶ relay.mjs :8787 ──UDP OSC──▶ ESP32 :9000
                                          └─UDP OSC──▶ TouchDesigner / Max …
Any OSC app ──UDP OSC──▶ ESP32 :9000
```

Run the relay with `npm run relay -- --osc mirror.local:9000 --osc 127.0.0.1:7000`.
mDNS names work only if the host OS resolves them. Use the IP address
otherwise.
