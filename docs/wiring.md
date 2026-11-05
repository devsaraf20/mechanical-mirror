# Wiring guide

> ## ⚠️ VERIFY BEFORE BUILDING
>
> This guide is a **starting point. It has not been checked against your exact
> parts, and the build it describes has not been tested.** Board revisions,
> clones and supplies differ. Before you power anything:
>
> - **Check every pin against the datasheet and silkscreen of the parts you
>   actually have**: the ESP32 board, the PCA9685 boards (clones vary), and
>   the PSU terminals.
> - **Mains (AC) wiring is dangerous.** Use enclosed, certified supplies, and
>   have mains connections made or inspected by a qualified person. Follow
>   local electrical codes.
> - 5 V at 40 A won't shock you, but **it can start a fire**. Fuse every zone,
>   size the wires as shown, and don't leave a new build running unattended.
> - Bring it up **one board at a time** (see "Bring-up" below), on a current-
>   limited bench supply first if you have one.
>
> Use at your own risk.

---

## Overview

```
          MAINS ──[fused, switched IEC inlet]──┬──────────┬──────────┐
                                               │          │          │
                                          ┌────┴───┐ ┌────┴───┐ ┌────┴───┐
                                          │ PSU A  │ │ PSU B  │ │ PSU C  │   5 V ≥20 A each
                                          │ 5V 20A │ │ 5V 20A │ │ 5V 20A │
                                          └─┬────┬─┘ └─┬────┬─┘ └─┬────┬─┘
                                       +V  │    │ −V  │    │     │    │
                                     [20A fuse] │   [fuse]  │  [fuse]  │
                                           │    │     │     │     │    │
                          E-STOP (opens all three +V lines, or the mains to the PSUs)
                                           │    │     │     │     │    │
                                     ┌─────┴─┐  │ ┌───┴──┐  │ ┌───┴──┐ │
                                     │ BUS A+│  │ │BUS B+│  │ │BUS C+│ │   + 4700 µF per bus
                                     └┬──┬──┬┘  │ └┬──┬─┬┘  │ └┬──┬─┬┘ │
                              16 AWG  │  │  │   │  │  │ │   │  │  │ │ │
                                     B0 B1 B2   │ B3 B4 B5  │ B6 B7 B8 │   (V+ terminal of each PCA9685)
                                                │           │          │
            GROUND STAR ◀───────────────────────┴───────────┴──────────┘
              │  │  └──── each board's V+ GND terminal (16 AWG, paired with its + wire)
              │  └─────── ESP32 GND
              └────────── (USB supply for ESP32 is isolated; ground joins only here)
```

## 1. Logic: ESP32 → PCA9685 chain

| ESP32 (DevKit V1) | PCA9685 #0 logic header | Notes |
|---|---|---|
| **3V3** | VCC | Chip logic supply. **Not** V+. |
| **GND** | GND | |
| **GPIO 21** | SDA | |
| **GPIO 22** | SCL | |
| **GPIO 27** | OE | Active low. HIGH = all outputs off. |

Then daisy-chain board #0 → #1 → … → #8 with the 6-pin header on the
opposite edge. Connect **GND, OE, SCL, SDA and VCC only**.

> **Do not let V+ run through the logic header chain.** On Adafruit-style
> boards the 6-pin header also carries V+ on thin traces and pins. If your
> jumper cables include that pin, cut or remove it. Each board gets its own
> V+ feed (section 2).

**Addresses.** Bridge the A0–A5 solder jumpers so the boards are
consecutive from 0x40. On power-up the firmware prints `OK`/`MISSING` for
each board.

| Board | A5 A4 A3 A2 A1 A0 | Address | Tiles (default mapping) |
|---|---|---|---|
| 0 | 0 0 0 0 0 0 | 0x40 | 0–15 |
| 1 | 0 0 0 0 0 1 | 0x41 | 16–31 |
| 2 | 0 0 0 0 1 0 | 0x42 | 32–47 |
| 3 | 0 0 0 0 1 1 | 0x43 | 48–63 |
| 4 | 0 0 0 1 0 0 | 0x44 | 64–79 |
| 5 | 0 0 0 1 0 1 | 0x45 | 80–95 |
| 6 | 0 0 0 1 1 0 | 0x46 | 96–111 |
| 7 | 0 0 0 1 1 1 | 0x47 | 112–127 |
| 8 | 0 0 1 0 0 0 | 0x48 | 128–143 |

Never use 0x70. It's the PCA9685 all-call address.

**Tile index** = `row × 12 + col`, row 0 at the top, col 0 on the **left as
the viewer sees it**. Seen from behind (where you wire), left and right are
swapped. That's the most common wiring mistake. Change `tileToChannel()` in
`config.h` if you'd rather wire one row per board, and so on.

**I²C bus notes**

- Most PCA9685 breakouts have 10 kΩ pull-ups on SDA and SCL. Nine in
  parallel give about 1.1 kΩ, which is fine at 3.3 V. With more than ~12
  boards, remove the pull-ups on some of them.
- Keep the bus short. The total chain should be under ~1 m at 400 kHz. Route
  SDA/SCL away from servo power wires, and twist each with a ground. If you
  get errors, set `I2C_HZ` to 100000 or use a differential I²C extender.
- Most PCA9685 breakouts tie OE low through a resistor so outputs are enabled
  by default. GPIO 27 drives OE actively, so a stronger pull-up isn't needed.
  The PCA9685 also powers up with every output off, and the firmware keeps
  them off until the first command. **Check** whether your clone boards have
  a pull-down on OE. If they don't, add a 10 kΩ pull-up to 3V3 so outputs stay
  disabled while the ESP32 resets.

## 2. Servo power

1. **PSU → fuse → E-stop → zone bus (+)**, using 12 AWG. Put the 20 A
   slow-blow fuse as close to the PSU + terminal as you can.
2. **PSU − → zone bus (−) → ground star**, using 12 AWG.
3. From each zone bus, run a **separate 16 AWG pair to the V+ screw terminal
   of each of its three boards** (+ and GND). Keep the pairs together, not
   as separate loops.
4. Fit a **1000 µF / ≥10 V** capacitor across each board's V+ terminal
   (many boards have a footprint for it), and a **4700 µF** across each zone
   bus. **Check the polarity.** Electrolytics fail violently when reversed.
5. Connect the ESP32's GND to the ground star. The ESP32 itself runs from its
   own USB supply.

| Zone | PSU | Boards | Tiles | Rows (12×12, default mapping) |
|---|---|---|---|---|
| A | PSU A | 0, 1, 2 | 0–47 | 0–3 |
| B | PSU B | 3, 4, 5 | 48–95 | 4–7 |
| C | PSU C | 6, 7, 8 | 96–143 | 8–11 |

**Never connect the + outputs of two PSUs together.** The zones share ground
only.

## 3. Servos → boards

- Plug each servo into its board channel. Typical colours:
  **brown/black = GND, red = V+, orange/yellow/white = signal**. Match them to
  the board's **G / V+ / PWM** row. Check your servo's datasheet, because
  some clones differ.
- The PCA9685 drives the signal at its VCC level (3.3 V). MG90S and SG90
  servos accept 3.3 V signals. If yours don't, run the PCA9685 VCC at 5 V and
  use a level shifter on SDA/SCL.
- Label both ends of every extension lead with its tile number.
- Leave a strain-relief loop. The servos vibrate.

## 4. Mains side

- Feed all PSUs from one fused, switched IEC inlet or a switched, fused power
  strip.
- **Earth every PSU's protective-earth (⏚) terminal.**
- Use proper crimped ferrules, cover all mains terminals, and add strain
  relief where the cord enters the frame.
- Mains wiring should be done or checked by a qualified person.

## 5. Bring-up

1. **No servos connected.** Power the ESP32 over USB and open the serial
   monitor at 115200. Every board should report `OK`. Type `i` for status.
2. Power **one zone**. Use a current-limited bench supply at 5 V / 3 A if you
   have one. Plug in **one servo** on board 0, channel 0, without its tile.
   Type `t 0 0`, then `t 0 20` and `t 0 -20`. It should move smoothly.
3. Measure the voltage at the board's V+ terminal while servos move. It
   should stay above about 4.8 V.
4. Add servos a board at a time. Type `s` for a slow sweep test of
   everything. Watch the current on the PSU and feel the wires: nothing
   should get warm.
5. Fit the tiles, then calibrate (below).
6. Start the web app and connect to `ws://mirror.local:81` (direct) or run
   the relay (see README).

## 6. Calibration

1. Type `h` (home). Every tile should be flat. For each tile that isn't, find
   the trim in degrees (use `t <tile> <deg>` until it's flat) and enter it in
   `TILE_TRIM_DEG[]`.
2. Tiles that tilt the wrong way get `1` in `TILE_DIR_REVERSED[]`.
3. Set `ANGLE_MIN_DEG` / `ANGLE_MAX_DEG` a few degrees **inside** the angle
   where a tile hits its neighbour, its pushrod binds, or the servo reaches
   its end stop.
4. If ±20° looks wrong overall (for example, it's really ±25°), adjust
   `SERVO_US_PER_DEG`. If every servo is off by the same amount, measure a
   1500 µs pulse with a scope and adjust `PCA_OSC_HZ`.
5. In the web app, set **black → °** and **white → °** to suit your light,
   then lower **max speed** until the motion is quiet.

## Pin summary

| Signal | ESP32 pin | Goes to |
|---|---|---|
| SDA | GPIO 21 | PCA9685 SDA (chain) |
| SCL | GPIO 22 | PCA9685 SCL (chain) |
| OE | GPIO 27 | PCA9685 OE (chain) |
| 3V3 | 3V3 | PCA9685 VCC (chain) |
| GND | GND | PCA9685 GND (chain) **and** ground star |
| Status LED | GPIO 2 | On-board LED: slow blink = idle/limp, on = driving |
