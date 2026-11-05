# Power-supply calculation for many servos

> Run `npm run power` for the numbers below, or e.g.
> `npm run power -- --servos 256 --servo "MG90S (6V)" --zone 64` for your own build.
> The same model drives the **est. current** read-out in the web app, so you
> can see how the speed limit and smoothing change the load.

## 1. Know your servo

Every number here is a scaling of three measurements of **your** servo. The
defaults are typical figures for an MG90S at 5 V. Measure with a bench supply
and a multimeter, with a tile attached:

| | symbol | MG90S @ 5 V (default) | how to measure |
|---|---|---|---|
| Idle / holding | I<sub>idle</sub> | 10 mA | Powered and holding position, no load change |
| Moving | I<sub>move</sub> | 280 mA | Sweep ±40° continuously and read the average |
| Stall | I<sub>stall</sub> | 800 mA | Hold the horn while it pushes. **2–3 s at most.** |

A balanced tile on a centred hinge needs very little holding torque. If your
tiles hang off-centre, the holding current rises a lot.

## 2. The model

For **N** servos, with **d** = the fraction moving at the same time in normal
use, **s** = the fraction that may be stalled (a jammed tile, a tile against
its stop), and **h** = headroom:

```
I_typical    = N · (I_idle + d · (I_move − I_idle))
I_stall_add  = N · s · (I_stall − I_move)
I_design     = (I_typical + I_stall_add) · h
I_burst      = N · I_move                    (every servo starts at once, ~0.1 s)
I_fault      = N · I_stall                   (everything jammed: the fuse must blow)
```

How d behaves in each mode:

- **mirror** with a moving person: d ≈ 0.3–0.6
- **wave**: d ≈ 0.8–1.0. Every tile is always moving.
- **text** or a static image: d ≈ 0.1

The max-speed limit doesn't reduce the *peak* current of a servo that's
moving. It does make each move last longer and stop abruptly less often, so
**the average current goes down and the bursts get spread out**. The
smoothing and deadband settings stop camera noise from keeping all servos
twitching (d → 1), which matters even more.

## 3. Worked example: 144 × MG90S at 5 V

Settings: d = 0.6, s = 0.05, h = 1.3.

```
I_typical   = 144 · (0.010 + 0.6 · 0.270)            = 24.8 A
I_stall_add = 144 · 0.05 · (0.80 − 0.28)              =  3.7 A
I_design    = (24.8 + 3.7) · 1.3                      = 37.1 A   → 185 W at 5 V
I_burst     = 144 · 0.28                              = 40.3 A   (transient)
I_fault     = 144 · 0.80                              = 115 A    (must be fused)
```

### Split into zones

One 40 A, 5 V supply is possible, but it's a poor choice. 40 A at 5 V needs
very thick wiring, and a single fault dumps the whole budget into one place.
Use **3 zones of 48 servos (3 PCA9685 boards each)**:

| per zone | value |
|---|---|
| Design current | 37.1 / 3 = **12.4 A** |
| Burst (all 48 start) | 48 · 0.28 = 13.4 A |
| **Supply** | 5 V, **≥ 20 A** (e.g. LRS-150-5 class, ~22 A). About 40 % margin, so it runs cool. |
| **Fuse** | 20 A slow-blow on the + output |
| **Bulk capacitance** | ≥ 5000 µF per zone. Use 4700 µF at the bus + 1000 µF at each board. |
| PSU → bus wire | 12 AWG / 2.5–4 mm², keep under 1 m |
| Bus → board wire | 16 AWG / 1.5 mm² (each board ≈ 16 × 0.35 A ≈ 5–6 A peak) |

### Voltage drop check

Servos misbehave below about 4.6 V. At 13 A over 1 m of 12 AWG (≈ 5.2 mΩ/m,
×2 for the round trip):
`ΔV = 13 A × 0.0104 Ω ≈ 0.14 V`. That's fine. With 18 AWG (21 mΩ/m) it would
be 0.55 V, which is **not** fine. Most supplies have a V-adj trimmer. Setting
it to 5.1–5.2 V offsets the drop, but stay within the servo's rating.

## 4. Logic power (separate)

| Load | Current |
|---|---|
| ESP32 with Wi-Fi active | 150–250 mA (peaks ~500 mA) |
| 9 × PCA9685 logic (VCC) | ~10 mA each → ~90 mA, taken from the ESP32's 3V3 pin |

Power the ESP32 from its own USB 5 V adapter (1 A). Its 3.3 V regulator
feeds the PCA9685 VCC pins. **Connect grounds, never the 5 V rails**, between
the logic supply and the servo supplies.

## 5. Things that change the numbers

- **6 V servos** move faster and draw 20–30 % more current. Use the
  `MG90S (6V)` profile, and check that every part on the V+ rail (capacitors,
  the servos themselves) is rated for it.
- **Larger grids** scale linearly. Add a zone per ~48 servos.
- **Cold start**: when servo power comes on, some servos jump. The firmware
  wakes the boards one at a time 250 ms apart (`WAKE_STAGGER_MS`). Keep that.
- **Heat**: 185 W of servo power in a closed frame gets warm. Ventilate the
  supplies and leave gaps around them.
