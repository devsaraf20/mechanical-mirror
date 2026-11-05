// ===== Mechanical Mirror – ESP32 firmware configuration =====================
// Edit this file, not the .ino. Everything physical (grid size, pins, servo
// pulse range, limits) lives here.
#pragma once

// ---- Network ---------------------------------------------------------------
// Leave WIFI_SSID empty to start an access point "MechanicalMirror" instead
// (password AP_PASS, the ESP32 is then 192.168.4.1).
#define WIFI_SSID ""
#define WIFI_PASS ""
#define AP_SSID "MechanicalMirror"
#define AP_PASS "mirror1234"  // >= 8 chars
#define MDNS_NAME "mirror"    // → mirror.local

#define OSC_UDP_PORT 9000  // Physical Bridge OSC over UDP (from bridge/relay.mjs)
#define USE_WEBSOCKET 1    // 1 = also accept OSC packets as binary WebSocket msgs
#define WS_PORT 81         // ws://mirror.local:81  (needs "WebSockets" lib by Markus Sattler)

// ---- Grid ------------------------------------------------------------------
#define GRID_COLS 12
#define GRID_ROWS 12
#define NUM_TILES (GRID_COLS * GRID_ROWS)
#define CH_PER_BOARD 16
#define NUM_BOARDS ((NUM_TILES + CH_PER_BOARD - 1) / CH_PER_BOARD)  // 9 for 12x12
#define FIRST_BOARD_ADDR 0x40  // boards at 0x40, 0x41 ... (solder A0–A5 jumpers)
// NOTE: 0x70 is the PCA9685 "all call" address – never jumper a board to it.

// ---- Pins (ESP32 DevKit V1 / WROOM-32) ---------------------------------------
#define PIN_SDA 21
#define PIN_SCL 22
#define PIN_OE 27      // to OE on every PCA9685 (active LOW: HIGH = all outputs off)
#define PIN_STATUS_LED 2
#define I2C_HZ 400000  // drop to 100000 if the I2C bus is long (> ~1 m) or flaky

// ---- Servo electrical calibration -------------------------------------------
#define PWM_FREQ_HZ 50
#define PCA_OSC_HZ 25000000  // measure with a scope & adjust; real chips 24–27 MHz
#define SERVO_CENTER_US 1500 // pulse for 0° (tile flat, facing viewer)
#define SERVO_US_PER_DEG 10.0f  // ~ (2500-500)/180 ≈ 11.1 for most micro servos
#define SERVO_MIN_US 600     // absolute pulse clamp – protects the gear train
#define SERVO_MAX_US 2400

// ---- Tilt limits & motion safety -------------------------------------------
#define ANGLE_MIN_DEG -40.0f    // mechanical stop – tiles must not hit each other
#define ANGLE_MAX_DEG 40.0f
#define SLEW_DEG_PER_S 300.0f   // firmware-side speed cap (2nd line of defence)
#define UPDATE_HZ 100           // servo update loop
#define FAILSAFE_MS 2000        // no frames for this long → ease back to 0°
#define LIMP_AFTER_MS 120000    // no frames for this long → outputs off (quiet, cool)
#define WAKE_STAGGER_MS 250     // power-up: enable one board at a time (inrush!)

// ---- Per-tile mechanical calibration ----------------------------------------
// TRIM: degrees added to each tile so "0°" really is flat (horn spline offset).
// DIR:  +1 or -1 if a servo is mounted mirrored.
// Fill these in during calibration (see docs/wiring.md → Calibration).
// Left empty = all zero / all +1.
static const int8_t TILE_TRIM_DEG[NUM_TILES] = {0};
static const int8_t TILE_DIR_REVERSED[NUM_TILES] = {0};  // 1 = reversed

// Map tile index (row-major, row 0 = top, col 0 = left as seen by the viewer)
// to board/channel. Default: consecutive. Change if you wire per row.
inline void tileToChannel(int tile, uint8_t &board, uint8_t &ch) {
  board = tile / CH_PER_BOARD;
  ch = tile % CH_PER_BOARD;
}
