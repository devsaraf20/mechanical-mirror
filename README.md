# Mechanical Mirror

Software for a kinetic "mirror": a grid of tiles (default **12 × 12**), each
on a servo, that tilt toward or away from a light so the grid shows a
low-resolution picture of whoever stands in front of it.

- **Web app** (Vite + Three.js) with a 3D simulation of the tile grid. Each
  tile is lit by a key light, so tilt becomes brightness, with shadows
  between neighbouring tiles.
- **Webcam pipeline**: crop, area-averaged downsampling to the grid,
  auto-levels, contrast and gamma.
- **Modes**: `mirror`, `silhouette` (MediaPipe body segmentation running in
  the browser), `wave` (ripple, linear, interference, spiral, plasma,
  breathe) and `text` (scrolling 5×7 pixel font).
- **Brightness → angle mapping** with adjustable range, gamma, contrast,
  quantization and hard limits.
- **Motion planner** with smoothing, deadband, a max-speed limit and a
  max-acceleration limit, so the servos don't jerk.
- **Physical Bridge output** over WebSocket in OSC or JSON, plus a Node relay
  to OSC/UDP. See [docs/physical-bridge.md](docs/physical-bridge.md).
- **ESP32 firmware** for daisy-chained PCA9685 servo boards, with a failsafe,
  staggered wake-up and calibration tables:
  [firmware/esp32-mirror](firmware/esp32-mirror).
- **Hardware docs**: [parts list](docs/parts-list.md),
  [power-supply calculation](docs/power.md) and
  [wiring guide](docs/wiring.md). The wiring guide is marked **verify before
  building**.

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
```

The browser asks for camera access. Without a camera, or when it's denied,
the app falls back to an animated synthetic figure, so everything still
works. Camera access needs `https://` or `localhost`.

Other scripts:

```bash
npm test             # unit tests (mapping, motion limits, OSC/bridge encoding, power)
npm run build        # static build in dist/, served from any web server
npm run power        # power-supply sizing (see docs/power.md)
npm run relay -- --osc 192.168.1.50:9000     # WebSocket → OSC/UDP relay
```

## How it works

```
 webcam ─▶ GridSampler ─┐
 MediaPipe mask ────────┤ mode  ─▶ brightness grid ─▶ mapping ─▶ target angles
 wave / text generator ─┘ (0..1, cols×rows)          (°)        │
                                                                ▼
                                    MotionPlanner (deadband → low-pass → speed/accel limit)
                                                                │ commanded angles
                                         ┌──────────────────────┼─────────────────────┐
                                         ▼                      ▼                     ▼
                                  3D simulation          HUD previews       Physical Bridge (WS)
                                                                             ├─▶ ESP32 :81 (OSC binary)
                                                                             └─▶ relay ─▶ OSC/UDP
```

The simulator and the hardware get exactly the same rate-limited angles, so
what you see on screen is what the servos will do.

### Angle convention

0° = tile flat. **Positive = top edge tilts away from the viewer**, so the
face turns up toward the light and looks brighter. By default black maps to
−30° and white to +25°. The best range depends on where your light is:
roughly, the brightest tile faces halfway between the viewer and the light.
The simulator's *light elevation* control lets you try this out.

### Controls

| Folder | What it does |
|---|---|
| Mode | Content mode. *Calibration hold* forces every tile to neutral, dark or bright. Start/stop the webcam. |
| Grid | Columns and rows (2–48). Rebuilds the simulation. |
| Camera processing | Selfie mirroring, zoom, auto-levels, pre-blur. |
| Silhouette | Solid or shaded silhouette, threshold, edge softness, polarity. |
| Wave / Text | Pattern parameters, message, scroll speed, scale. |
| Brightness → angle | Black/white angles, gamma, contrast, quantize levels, invert, hard limits. |
| Motion | Smoothing τ, **max speed °/s**, max accel °/s², deadband. |
| Simulation | Tile material (wood, matte white, brushed metal, mirror), light elevation, servo type for the current estimate. |
| Physical Bridge output | URL, format (osc/json), rate, connect, servos on/off, home. |

Settings are saved in the browser's localStorage.

### Tuning motion

- **max speed** sets how fast a tile can turn. 120–200 °/s looks lively and
  keeps micro servos quiet. Above ~400 °/s you're at the servo's own limit.
- **max accel** removes the "clack" at the start and end of each move.
  Around 1000–2000 °/s² works well.
- **smoothing τ** filters camera noise. 0.1–0.2 s works well. Higher values
  look dreamy and laggy.
- **deadband** stops tiles from hunting around a value. With it, a static
  scene really is static, which also saves power (see `docs/power.md`).

The HUD shows an estimate of the live servo current using the same model as
`npm run power`.

## Connecting hardware

1. Build and flash [firmware/esp32-mirror](firmware/esp32-mirror). Use the
   Arduino IDE (libraries: *Adafruit PWM Servo Driver Library* and
   *WebSockets* by Markus Sattler), or PlatformIO (`pio run -t upload`). Set
   your Wi-Fi details in `config.h`. Without them, the board opens an access
   point called `MechanicalMirror`.
2. Wire it up following [docs/wiring.md](docs/wiring.md). **Verify before
   building.**
3. In the web app, set **Physical Bridge output → WebSocket URL**:
   - direct: `ws://mirror.local:81` (or the ESP32's IP) with format **osc**
   - through the relay: `npm run relay -- --osc <esp32-ip>:9000`, then
     `ws://localhost:8787` with format **osc** or **json**
4. Click **connect**. The ESP32 wakes the boards one at a time and follows
   the frames. **servos OFF** makes every servo go limp immediately.

The relay can fan out to several OSC targets at once, for example the
mirror plus TouchDesigner: `--osc a:9000 --osc b:7000`.

## Offline silhouette mode

The MediaPipe WASM runtime is bundled from `node_modules`, and the
`selfie_segmenter` model (Apache-2.0, from Google MediaPipe) ships in
`public/models/`. Silhouette mode therefore works without internet access.
If the model file is missing, the app downloads it from Google's model CDN.

## Project layout

```
index.html, src/
  main.js               app wiring, GUI, frame loop
  core/mapping.js       brightness → angle
  core/motion.js        smoothing + speed/accel limiter
  core/power.js         servo current model (shared with scripts/power-calc.mjs)
  input/                webcam, grid sampler, MediaPipe segmenter
  modes/                mirror, silhouette, wave, text (+ 5×7 font)
  sim/mirrorSim.js      Three.js scene
  bridge/               OSC encoder, Physical Bridge client
bridge/relay.mjs        WebSocket → OSC/UDP relay (Node)
firmware/esp32-mirror/  ESP32 + PCA9685 firmware (Arduino / PlatformIO)
docs/                   bridge spec, parts list, power, wiring
scripts/power-calc.mjs  supply sizing CLI
test/                   vitest unit tests
```
