# Parts list: 12 × 12 mechanical mirror (approximate)

Quantities are for the default **12 × 12 = 144 tiles** and include about 10 %
spares where parts tend to fail or get damaged during assembly. They are
estimates. Lengths especially depend on your layout. For other grid sizes,
scale the per-tile lines and recompute the boards (`ceil(tiles / 16)`) and
the power (`npm run power -- --servos N`).

## Electronics

| Qty | Part | Notes |
|---|---|---|
| 160 | Micro servo, **MG90S** (metal gear) | 144 + 16 spare. SG90 (plastic gears) is cheaper but wears and buzzes more. Buy from one batch so their pulse range matches. |
| 10 | **PCA9685** 16-channel PWM board (Adafruit 815 or compatible) | 9 needed (9 × 16 = 144) + 1 spare. Each needs a unique address (0x40–0x48). |
| 1 (+1) | **ESP32** DevKit V1 / WROOM-32 | A spare is handy. |
| 3 | **5 V, ≥ 20 A** enclosed switching supply (e.g. Mean Well LRS-150-5 class) | One per 48-servo zone. See [power.md](power.md). 6 V supplies give more speed and torque *if* your servos are rated for it. |
| 1 | USB 5 V supply, 1 A, for the ESP32 | Keeps the logic off the noisy servo rails. |
| 3 | Inline fuse holder + **20 A slow-blow** fuse (blade/ATO) | One per zone, on the + output of each PSU. |
| 1 | IEC mains inlet with switch + fuse, or a switched fused power strip | Mains side. See wiring guide. |
| 1 | Emergency-stop / master switch for the servo DC side | Cuts servo power without killing the controller. |
| 9 | Electrolytic capacitor **1000 µF, ≥ 10 V**, low-ESR | One on each PCA9685 V+ terminal. |
| 3 | Electrolytic capacitor **4700 µF, ≥ 10 V**, low-ESR | One per zone bus, near the fuse. |
| 3 + 3 | Bus bars / power distribution blocks (+ and −), ≥ 30 A | One pair per zone. Lever connectors (e.g. Wago 221) work for the branches. |
| 1 | Ground distribution block | Star point that ties all PSU −, ESP32 GND and board GND together. |
| ~150 | Servo extension leads, 15–30 cm (JR/Futaba 3-pin) | Depends on how far tiles are from their board. Some servos reach without one. |
| 9 | 6-pin female–female jumper / JST cable, ~10–20 cm | For daisy-chaining the boards' logic header (GND, OE, SCL, SDA, VCC). **Don't** pass V+ through it. See wiring guide. |
| ~3 m each | Silicone wire **12 AWG** (2.5–4 mm²), red + black | PSU → fuse → zone bus. |
| ~10 m each | Silicone wire **16 AWG** (1.5 mm²), red + black | Zone bus → each PCA9685 V+ terminal. |
| ~2 m | 4-core shielded / twisted cable, 22–24 AWG | ESP32 → first board (SDA, SCL, GND, 3V3) + OE. |
| 1 | 1 kΩ resistor, 1 LED | Optional external status LED. |
| — | Heat-shrink, ferrules, cable ties, labels | Label every zone and board. |

## Mechanics (one possible build)

The firmware and software don't depend on the mechanics. This is the build
the simulator models: 40 mm tiles on a 44 mm pitch, each hinged at its
horizontal centre line and driven by the servo behind the backboard
through a short pushrod.

| Qty | Part | Notes |
|---|---|---|
| 160 | Tile, **40 × 40 × 3–4 mm** | Birch plywood, MDF, or acrylic. Light, matte, light-coloured faces give the best contrast. Laser cutting is ideal. |
| 12 | Brass or steel rod, **1.5–2 mm × ~600 mm** | One horizontal hinge rod per row. Tiles pivot freely on it. |
| 160 | Short brass tube or printed hinge clip | Fixes each tile to the rod with low friction. |
| 160 | Pushrod: 0.8–1 mm music wire, ~50 mm, Z-bend both ends | Servo horn → tile tab. |
| 160 | Small tab / control horn glued to the tile back | Offset from the hinge sets the lever ratio. |
| 1 | Backboard, 6–9 mm plywood, ~600 × 600 mm | Drill or cut slots for the pushrods. Servos mount behind it. |
| ~4 m | Frame timber, e.g. 20 × 70 mm | Deep enough to hide the servos (servo + wiring depth ≈ 50 mm). |
| 320 | M2 × 8 screws (or hot glue / printed brackets) | Servo mounting. Two per servo. |
| — | Wall cleats, rubber feet, ventilation holes | The supplies make heat. Leave airflow. |

## Optional

- 1 × USB webcam with manual exposure (auto-exposure fights the mirror's own
  shading). A phone running the web app over Wi-Fi also works.
- 1 × light source: a spotlight or LED bar **above** the mirror, aimed down
  at it at about 45–60°. The image depends on it. Match the simulator's
  "light elevation".
- A Raspberry Pi or mini PC to run the web app permanently.
- Logic analyser or oscilloscope for calibrating `PCA_OSC_HZ`.
