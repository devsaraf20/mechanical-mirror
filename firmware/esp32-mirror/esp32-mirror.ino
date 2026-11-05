// Mechanical Mirror – ESP32 + PCA9685 servo driver firmware
//
// Receives Physical Bridge frames (OSC /pb/frame, see docs/physical-bridge.md)
// over UDP and/or WebSocket and drives up to NUM_TILES hobby servos through
// daisy-chained PCA9685 16-channel PWM boards.
//
// Safety features:
//   * outputs disabled (OE high + all channels off) until the first command
//   * staggered wake-up, one board at a time, to limit inrush current
//   * hard angle and pulse-width clamps
//   * firmware slew-rate limit independent of the client
//   * failsafe: no frames → ease to 0°, later go limp
//
// Libraries (Arduino Library Manager):
//   - "Adafruit PWM Servo Driver Library" (Adafruit)
//   - "WebSockets" by Markus Sattler   (only if USE_WEBSOCKET = 1)
// Board: "ESP32 Dev Module" (arduino-esp32 core 2.x or 3.x)
//
// Serial console (115200): h = home, l = limp, e = enable, s = sweep test,
//   t <tile> <deg> = move one tile, i = info.

#include <Arduino.h>
#include <Wire.h>
#include <WiFi.h>
#include <WiFiUdp.h>
#include <ESPmDNS.h>
#include <Adafruit_PWMServoDriver.h>
#include "config.h"
#if USE_WEBSOCKET
#include <WebSocketsServer.h>
#endif

// ---------------------------------------------------------------- state
static Adafruit_PWMServoDriver *boards[NUM_BOARDS];
static bool boardPresent[NUM_BOARDS];
static bool boardAwake[NUM_BOARDS];

static float target[NUM_TILES];   // degrees, requested
static float current[NUM_TILES];  // degrees, commanded (slew limited)
static uint16_t lastTicks[NUM_TILES];

enum Mode { LIMP, WAKING, RUNNING };
static Mode mode = LIMP;
static uint32_t lastFrameMs = 0;
static uint32_t wakeStartMs = 0;
static int32_t lastSeq = 0;
static uint32_t frameCount = 0, badPackets = 0;
static bool sweepTest = false;

WiFiUDP udp;
#if USE_WEBSOCKET
WebSocketsServer ws(WS_PORT);
#endif

// ---------------------------------------------------------------- servo out
static const float TICKS_PER_US = (PWM_FREQ_HZ * 4096.0f) / 1000000.0f;  // 0.2048 @50Hz

static uint16_t angleToTicks(int tile, float deg) {
  float a = deg + TILE_TRIM_DEG[tile];
  if (TILE_DIR_REVERSED[tile]) a = -a;
  float us = SERVO_CENTER_US + a * SERVO_US_PER_DEG;
  us = constrain(us, (float)SERVO_MIN_US, (float)SERVO_MAX_US);
  return (uint16_t)(us * TICKS_PER_US + 0.5f);
}

static void writeTile(int tile, bool force = false) {
  uint8_t b, ch;
  tileToChannel(tile, b, ch);
  if (b >= NUM_BOARDS || !boardPresent[b] || !boardAwake[b]) return;
  uint16_t t = angleToTicks(tile, current[tile]);
  if (!force && t == lastTicks[tile]) return;  // only touch the bus when needed
  boards[b]->setPWM(ch, 0, t);
  lastTicks[tile] = t;
}

static void boardOff(int b) {
  if (!boardPresent[b]) return;
  for (int ch = 0; ch < CH_PER_BOARD; ch++) boards[b]->setPWM(ch, 0, 4096);  // full OFF → servo limp
  boardAwake[b] = false;
}

static void goLimp() {
  for (int b = 0; b < NUM_BOARDS; b++) boardOff(b);
  digitalWrite(PIN_OE, HIGH);
  for (int i = 0; i < NUM_TILES; i++) lastTicks[i] = 0xFFFF;
  mode = LIMP;
  Serial.println("[servo] limp");
}

// Start pulses board by board. Servos jump to wherever `current` is (0° after
// boot) the moment they get their first pulse – staggering keeps the inrush
// of NUM_TILES servos starting together off the supply.
static void startWake() {
  if (mode != LIMP) return;
  for (int i = 0; i < NUM_TILES; i++) {
    current[i] = 0;
    if (mode == LIMP) lastTicks[i] = 0xFFFF;
  }
  digitalWrite(PIN_OE, LOW);
  wakeStartMs = millis();
  mode = WAKING;
  Serial.println("[servo] waking");
}

static void serviceWake() {
  int n = (millis() - wakeStartMs) / WAKE_STAGGER_MS + 1;
  for (int b = 0; b < NUM_BOARDS && b < n; b++) {
    if (!boardAwake[b]) {
      boardAwake[b] = true;
      for (int i = 0; i < NUM_TILES; i++) {
        uint8_t bb, ch;
        tileToChannel(i, bb, ch);
        if (bb == b) writeTile(i, true);
      }
    }
  }
  if (n >= NUM_BOARDS) {
    mode = RUNNING;
    Serial.println("[servo] running");
  }
}

// ---------------------------------------------------------------- OSC parse
static inline int32_t be32(const uint8_t *p) { return (int32_t)((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]); }
static inline int16_t be16(const uint8_t *p) { return (int16_t)((p[0] << 8) | p[1]); }
static inline size_t pad4(size_t n) { return (n + 3) & ~(size_t)3; }

// Reads a NUL-terminated, 4-byte padded OSC string. Returns next offset or 0.
static size_t oscString(const uint8_t *buf, size_t len, size_t off, const char *&out) {
  size_t e = off;
  while (e < len && buf[e] != 0) e++;
  if (e >= len) return 0;
  out = (const char *)(buf + off);
  return pad4(e + 1);
}

static void onFrame(int32_t seq, int32_t cols, int32_t rows, const uint8_t *blob, int32_t blobLen) {
  if (cols <= 0 || rows <= 0 || blobLen < cols * rows * 2) {
    badPackets++;
    return;
  }
  // Accept a differently sized frame by copying the overlapping region.
  int c = min((int)cols, GRID_COLS), r = min((int)rows, GRID_ROWS);
  for (int y = 0; y < r; y++)
    for (int x = 0; x < c; x++) {
      float a = be16(blob + 2 * (y * cols + x)) / 10.0f;
      target[y * GRID_COLS + x] = constrain(a, ANGLE_MIN_DEG, ANGLE_MAX_DEG);
    }
  lastSeq = seq;
  lastFrameMs = millis();
  frameCount++;
  sweepTest = false;
  if (mode == LIMP) startWake();
}

static void handleOsc(const uint8_t *buf, size_t len) {
  const char *addr, *tags;
  size_t o = oscString(buf, len, 0, addr);
  if (!o) { badPackets++; return; }
  o = oscString(buf, len, o, tags);
  if (!o || tags[0] != ',') { badPackets++; return; }

  if (!strcmp(addr, "/pb/frame") && !strcmp(tags, ",iiib")) {
    if (o + 16 > len) { badPackets++; return; }
    int32_t seq = be32(buf + o), cols = be32(buf + o + 4), rows = be32(buf + o + 8), n = be32(buf + o + 12);
    o += 16;
    if (n < 0 || o + (size_t)n > len) { badPackets++; return; }
    onFrame(seq, cols, rows, buf + o, n);
  } else if (!strcmp(addr, "/pb/enable") && !strcmp(tags, ",i") && o + 4 <= len) {
    if (be32(buf + o)) { lastFrameMs = millis(); startWake(); }
    else goLimp();
  } else if (!strcmp(addr, "/pb/home")) {
    for (int i = 0; i < NUM_TILES; i++) target[i] = 0;
    lastFrameMs = millis();
    if (mode == LIMP) startWake();
  } else if (!strcmp(addr, "/pb/hello")) {
    Serial.printf("[net] hello from client\n");
  }
}

#if USE_WEBSOCKET
static void onWs(uint8_t num, WStype_t type, uint8_t *payload, size_t len) {
  if (type == WStype_BIN) handleOsc(payload, len);
  else if (type == WStype_TEXT) ws.sendTXT(num, "{\"error\":\"send Physical Bridge OSC (binary); use the relay for JSON\"}");
  else if (type == WStype_CONNECTED) Serial.printf("[ws] client %u connected\n", num);
}
#endif

// ---------------------------------------------------------------- setup
static void setupWifi() {
  if (strlen(WIFI_SSID)) {
    WiFi.mode(WIFI_STA);
    WiFi.setSleep(false);  // lower latency
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    Serial.printf("[wifi] connecting to %s", WIFI_SSID);
    uint32_t t0 = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - t0 < 15000) { delay(250); Serial.print('.'); }
    Serial.println();
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[wifi] IP %s\n", WiFi.localIP().toString().c_str());
  } else {
    WiFi.mode(WIFI_AP);
    WiFi.softAP(AP_SSID, AP_PASS);
    Serial.printf("[wifi] access point \"%s\", IP %s\n", AP_SSID, WiFi.softAPIP().toString().c_str());
  }
  if (MDNS.begin(MDNS_NAME)) Serial.printf("[wifi] mDNS %s.local\n", MDNS_NAME);
  udp.begin(OSC_UDP_PORT);
  Serial.printf("[net] OSC/UDP on port %d\n", OSC_UDP_PORT);
#if USE_WEBSOCKET
  ws.begin();
  ws.onEvent(onWs);
  Serial.printf("[net] WebSocket on port %d\n", WS_PORT);
#endif
}

void setup() {
  // OE high FIRST so nothing twitches while we configure the boards.
  pinMode(PIN_OE, OUTPUT);
  digitalWrite(PIN_OE, HIGH);
  pinMode(PIN_STATUS_LED, OUTPUT);
  Serial.begin(115200);
  delay(200);
  Serial.printf("\nMechanical Mirror  %dx%d = %d tiles on %d PCA9685 boards\n", GRID_COLS, GRID_ROWS, NUM_TILES, NUM_BOARDS);

  Wire.begin(PIN_SDA, PIN_SCL);
  Wire.setClock(I2C_HZ);
  for (int b = 0; b < NUM_BOARDS; b++) {
    uint8_t addr = FIRST_BOARD_ADDR + b;
    Wire.beginTransmission(addr);
    boardPresent[b] = Wire.endTransmission() == 0;
    Serial.printf("[i2c] board %d @0x%02X %s\n", b, addr, boardPresent[b] ? "OK" : "MISSING");
    boards[b] = new Adafruit_PWMServoDriver(addr, Wire);
    if (boardPresent[b]) {
      boards[b]->begin();
      boards[b]->setOscillatorFrequency(PCA_OSC_HZ);
      boards[b]->setPWMFreq(PWM_FREQ_HZ);
    }
  }
  for (int i = 0; i < NUM_TILES; i++) { target[i] = current[i] = 0; lastTicks[i] = 0xFFFF; }
  goLimp();
  setupWifi();
}

// ---------------------------------------------------------------- serial
static void serialCommands() {
  if (!Serial.available()) return;
  String line = Serial.readStringUntil('\n');
  line.trim();
  if (!line.length()) return;
  char c = line[0];
  if (c == 'h') { for (int i = 0; i < NUM_TILES; i++) target[i] = 0; lastFrameMs = millis(); startWake(); }
  else if (c == 'l') goLimp();
  else if (c == 'e') { lastFrameMs = millis(); startWake(); }
  else if (c == 's') { sweepTest = true; lastFrameMs = millis(); startWake(); Serial.println("sweep test – any frame stops it"); }
  else if (c == 't') {
    int tile; float deg;
    if (sscanf(line.c_str() + 1, "%d %f", &tile, &deg) == 2 && tile >= 0 && tile < NUM_TILES) {
      target[tile] = constrain(deg, ANGLE_MIN_DEG, ANGLE_MAX_DEG);
      lastFrameMs = millis();
      startWake();
      uint8_t b, ch; tileToChannel(tile, b, ch);
      Serial.printf("tile %d (board %d ch %d) -> %.1f deg\n", tile, b, ch, target[tile]);
    }
  } else if (c == 'i') {
    Serial.printf("mode=%d frames=%lu bad=%lu seq=%ld last=%lums ago\n", mode, (unsigned long)frameCount,
                  (unsigned long)badPackets, (long)lastSeq, (unsigned long)(millis() - lastFrameMs));
  }
}

// ---------------------------------------------------------------- loop
void loop() {
  // Network in.
  int n;
  static uint8_t pkt[4096];
  while ((n = udp.parsePacket()) > 0) {
    int r = udp.read(pkt, sizeof(pkt));
    if (r > 0) handleOsc(pkt, r);
  }
#if USE_WEBSOCKET
  ws.loop();
#endif
  serialCommands();

  static uint32_t lastTick = micros();
  uint32_t nowUs = micros();
  if (nowUs - lastTick < 1000000UL / UPDATE_HZ) return;
  float dt = (nowUs - lastTick) / 1e6f;
  lastTick = nowUs;
  uint32_t now = millis();

  if (sweepTest) {
    float a = ANGLE_MAX_DEG * 0.6f * sinf(now / 1000.0f * 2 * PI * 0.25f);
    for (int i = 0; i < NUM_TILES; i++) target[i] = a;
    lastFrameMs = now;
  }

  // Failsafe.
  uint32_t silent = now - lastFrameMs;
  if (mode != LIMP && silent > FAILSAFE_MS) for (int i = 0; i < NUM_TILES; i++) target[i] = 0;
  if (mode != LIMP && silent > LIMP_AFTER_MS) goLimp();

  if (mode == LIMP) {
    digitalWrite(PIN_STATUS_LED, (now / 1000) & 1);  // slow blink = idle
    return;
  }
  digitalWrite(PIN_STATUS_LED, HIGH);
  if (mode == WAKING) serviceWake();

  // Slew-limit and output.
  float step = SLEW_DEG_PER_S * dt;
  for (int i = 0; i < NUM_TILES; i++) {
    float d = target[i] - current[i];
    current[i] += constrain(d, -step, step);
    writeTile(i);
  }
}
