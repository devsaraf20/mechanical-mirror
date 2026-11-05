import GUI from 'lil-gui';
import { MirrorSim, MATERIALS } from './sim/mirrorSim.js';
import { Camera } from './input/camera.js';
import { GridSampler } from './input/gridSampler.js';
import { Segmenter } from './input/segmenter.js';
import { MODE_NAMES, mirrorMode, silhouetteMode, waveMode, textMode } from './modes/modes.js';
import { DEFAULT_MAPPING, mapGrid } from './core/mapping.js';
import { DEFAULT_MOTION, MotionPlanner } from './core/motion.js';
import { SERVO_PROFILES, DEFAULT_PROFILE, estimateCurrent } from './core/power.js';
import { PhysicalBridgeClient } from './bridge/physicalBridge.js';
import { drawInput, drawGrid, drawAngles } from './ui/previews.js';

// ---------------------------------------------------------------- settings
const DEFAULTS = {
  cols: 12,
  rows: 12,
  mode: 'mirror',
  hold: 'off', // calibration override: off | neutral | dark | bright
  // input
  mirrorImage: true,
  zoom: 1,
  autoLevels: true,
  blur: 0,
  // silhouette
  silhouetteStyle: 'solid',
  silhouetteThreshold: 0.5,
  silhouetteSoftness: 0.15,
  silhouetteInvert: false,
  // wave
  wavePattern: 'ripple',
  waveLength: 8,
  waveSpeed: 0.35,
  waveAngle: 0,
  waveAmplitude: 1,
  // text
  text: 'HELLO',
  textSpeed: 4,
  textScale: 0,
  textInvert: false,
  // mapping + motion
  ...DEFAULT_MAPPING,
  ...DEFAULT_MOTION,
  // sim
  material: 'wood',
  lightElevation: 55,
  // bridge
  bridgeUrl: 'ws://localhost:8787',
  bridgeFormat: 'osc',
  bridgeRate: 30,
  servoProfile: DEFAULT_PROFILE,
};

const STORE_KEY = 'mechanical-mirror-settings-v1';
function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORE_KEY) || '{}'), hold: 'off' };
  } catch {
    return { ...DEFAULTS };
  }
}
let saveTimer;
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(P));
    } catch {}
  }, 300);
}

const P = loadSettings();

// ---------------------------------------------------------------- systems
const sim = new MirrorSim(document.getElementById('sim'));
sim.setMaterial(P.material);
sim.setLightElevation(P.lightElevation);

const camera = new Camera();
const sampler = new GridSampler();
const maskSampler = new GridSampler();
const segmenter = new Segmenter();
const bridge = new PhysicalBridgeClient();
bridge.rate = P.bridgeRate;
bridge.onStatus = () => updateStats(true);

let brightness, targets, scratchBuf;
const planner = new MotionPlanner(0);
const textState = {};

function setupGrid() {
  const n = P.cols * P.rows;
  brightness = new Float32Array(n).fill(0.5);
  targets = new Float32Array(n);
  scratchBuf = new Float32Array(n);
  planner.resize(n, 0);
  sim.setGrid(P.cols, P.rows);
}
setupGrid();

const ctx = {
  camera,
  sampler,
  maskSampler,
  segmenter,
  time: 0,
  get cols() {
    return P.cols;
  },
  get rows() {
    return P.rows;
  },
  scratch: () => scratchBuf,
};

// ---------------------------------------------------------------- GUI
const gui = new GUI({ title: 'Controls', width: 300 });
gui.onChange(saveSettings);

const fMode = gui.addFolder('Mode');
fMode.add(P, 'mode', MODE_NAMES)
  .name('content')
  .onChange((m) => {
    updateFolders();
    if ((m === 'mirror' || m === 'silhouette') && !camera.ready && !camera.error) startCamera();
  });
fMode.add(P, 'hold', ['off', 'neutral', 'dark', 'bright']).name('calibration hold');
const camActions = {
  start: () => startCamera(),
  stop: () => {
    camera.stop();
    showMessage('Camera stopped — using synthetic input.');
  },
};
fMode.add(camActions, 'start').name('▶ start webcam');
fMode.add(camActions, 'stop').name('■ stop webcam');

const fGrid = gui.addFolder('Grid');
fGrid.add(P, 'cols', 2, 48, 1).onFinishChange(setupGrid);
fGrid.add(P, 'rows', 2, 48, 1).onFinishChange(setupGrid);
fGrid.close();

const fInput = gui.addFolder('Camera processing');
fInput.add(P, 'mirrorImage').name('mirror (selfie view)');
fInput.add(P, 'zoom', 1, 3, 0.05);
fInput.add(P, 'autoLevels').name('auto levels');
fInput.add(P, 'blur', 0, 6, 0.5).name('pre-blur px');

const fSil = gui.addFolder('Silhouette');
fSil.add(P, 'silhouetteStyle', ['solid', 'shaded']).name('style');
fSil.add(P, 'silhouetteThreshold', 0.05, 0.95, 0.01).name('threshold');
fSil.add(P, 'silhouetteSoftness', 0, 0.5, 0.01).name('edge softness');
fSil.add(P, 'silhouetteInvert').name('bright person');

const fWave = gui.addFolder('Wave');
fWave.add(P, 'wavePattern', ['ripple', 'linear', 'interference', 'spiral', 'plasma', 'breathe']).name('pattern');
fWave.add(P, 'waveLength', 1, 40, 0.5).name('wavelength (tiles)');
fWave.add(P, 'waveSpeed', 0, 2, 0.01).name('speed (Hz)');
fWave.add(P, 'waveAngle', 0, 360, 1).name('direction °');
fWave.add(P, 'waveAmplitude', 0, 1, 0.01).name('amplitude');

const fText = gui.addFolder('Text');
fText.add(P, 'text');
fText.add(P, 'textSpeed', 0, 20, 0.5).name('scroll (tiles/s)');
fText.add(P, 'textScale', 0, 6, 1).name('scale (0 = auto)');
fText.add(P, 'textInvert').name('bright text');

const fMap = gui.addFolder('Brightness → angle');
fMap.add(P, 'darkAngle', -60, 60, 0.5).name('black → °');
fMap.add(P, 'brightAngle', -60, 60, 0.5).name('white → °');
fMap.add(P, 'gamma', 0.3, 3, 0.05);
fMap.add(P, 'contrast', 0.2, 3, 0.05);
fMap.add(P, 'quantize', 0, 16, 1).name('levels (0 = smooth)');
fMap.add(P, 'invert');
fMap.add(P, 'limitMin', -90, 0, 1).name('hard limit min °');
fMap.add(P, 'limitMax', 0, 90, 1).name('hard limit max °');

const fMotion = gui.addFolder('Motion (servo protection)');
fMotion.add(P, 'smoothing', 0, 1, 0.01).name('smoothing τ (s)');
fMotion.add(P, 'maxSpeed', 10, 600, 5).name('max speed °/s');
fMotion.add(P, 'maxAccel', 0, 6000, 50).name('max accel °/s² (0=off)');
fMotion.add(P, 'deadband', 0, 3, 0.1).name('deadband °');

const fSim = gui.addFolder('Simulation');
fSim.add(P, 'material', MATERIALS).onChange((m) => sim.setMaterial(m));
fSim.add(P, 'lightElevation', 10, 85, 1).name('light elevation °').onChange((e) => sim.setLightElevation(e));
fSim.add(P, 'servoProfile', Object.keys(SERVO_PROFILES)).name('servo (power est.)');
fSim.close();

const fBridge = gui.addFolder('Physical Bridge output');
fBridge.add(P, 'bridgeUrl').name('WebSocket URL');
fBridge.add(P, 'bridgeFormat', ['osc', 'json']).name('format');
fBridge.add(P, 'bridgeRate', 5, 60, 1).name('rate (Hz)').onChange((v) => (bridge.rate = v));
const bridgeActions = {
  connect: () => bridge.connect(P.bridgeUrl, P.bridgeFormat),
  disconnect: () => bridge.disconnect(),
  enable: () => bridge.sendControl('enable', true),
  disable: () => bridge.sendControl('enable', false),
  home: () => bridge.sendControl('home'),
};
fBridge.add(bridgeActions, 'connect').name('connect');
fBridge.add(bridgeActions, 'disconnect').name('disconnect');
fBridge.add(bridgeActions, 'enable').name('servos ON');
fBridge.add(bridgeActions, 'disable').name('servos OFF (limp)');
fBridge.add(bridgeActions, 'home').name('home (all to 0°)');

const reset = {
  reset: () => {
    try {
      localStorage.removeItem(STORE_KEY);
    } catch {}
    location.reload();
  },
};
gui.add(reset, 'reset').name('reset all settings');

function updateFolders() {
  const m = P.mode;
  fInput.show(m === 'mirror' || m === 'silhouette');
  fSil.show(m === 'silhouette');
  fWave.show(m === 'wave');
  fText.show(m === 'text');
}
updateFolders();

// ---------------------------------------------------------------- HUD
const pvInput = document.getElementById('pv-input');
const pvGrid = document.getElementById('pv-grid');
const pvAngle = document.getElementById('pv-angle');
const statsEl = document.getElementById('stats');
const badge = document.getElementById('source-badge');
const msgEl = document.getElementById('message');

function showMessage(s) {
  msgEl.hidden = !s;
  msgEl.textContent = s || '';
}

async function startCamera() {
  showMessage('Requesting camera…');
  const ok = await camera.start();
  showMessage(ok ? '' : `Camera unavailable (${camera.error}). Using synthetic input.`);
}

let fps = 60;
let lastStats = 0;
let ampsSmoothed = 0;
function updateStats(force, now = performance.now()) {
  if (!force && now - lastStats < 250) return;
  lastStats = now;
  const bs = bridge.status;
  const bCls = bs === 'connected' ? 'ok' : bs.startsWith('error') ? 'bad' : bs === 'disconnected' ? '' : 'warn';
  const prof = SERVO_PROFILES[P.servoProfile];
  const ampsCls = ampsSmoothed > P.cols * P.rows * prof.moving * 0.7 ? 'warn' : '';
  let seg = '';
  if (P.mode === 'silhouette') seg = `<dt>segmenter</dt><dd>${segmenter.status}</dd>`;
  statsEl.innerHTML = `
    <dt>grid</dt><dd>${P.cols}×${P.rows} = ${P.cols * P.rows} servos</dd>
    <dt>fps</dt><dd>${fps.toFixed(0)}</dd>
    <dt>bridge</dt><dd class="${bCls}">${bs}${bridge.sent ? ` · ${bridge.sent} frames` : ''}</dd>
    <dt>est. current</dt><dd class="${ampsCls}">${ampsSmoothed.toFixed(1)} A</dd>
    ${seg}`;
  const live = camera.ready;
  badge.textContent = live ? 'webcam' : P.mode === 'wave' || P.mode === 'text' ? 'generated' : 'synthetic';
  badge.classList.toggle('live', live);
}

// ---------------------------------------------------------------- loop
const HOLD = { neutral: () => 0, dark: () => P.darkAngle, bright: () => P.brightAngle };
let last = performance.now();
function frame(now) {
  const dt = (now - last) / 1000;
  last = now;
  fps += (1 / Math.max(dt, 1e-3) - fps) * 0.05;
  ctx.time = now / 1000;

  let input = null;
  if (P.mode === 'mirror') input = mirrorMode(ctx, brightness, P);
  else if (P.mode === 'silhouette') input = silhouetteMode(ctx, brightness, P);
  else if (P.mode === 'wave') waveMode(ctx, brightness, P);
  else if (P.mode === 'text') textMode(ctx, brightness, P, textState);

  if (P.hold !== 'off') targets.fill(HOLD[P.hold]());
  else mapGrid(brightness, targets, P);

  planner.setTargets(targets, P.deadband);
  const angles = planner.step(dt, P);
  sim.setAngles(angles);
  sim.render();
  bridge.maybeSend(now, P.cols, P.rows, angles);

  ampsSmoothed += (estimateCurrent(planner.velocity, SERVO_PROFILES[P.servoProfile]) - ampsSmoothed) * 0.1;

  if (input) drawInput(pvInput, input, P);
  else drawGrid(pvInput, brightness, P.cols, P.rows);
  drawGrid(pvGrid, brightness, P.cols, P.rows);
  drawAngles(pvAngle, angles, P.cols, P.rows, P);
  updateStats(false, now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Try the webcam straight away; fall back silently to synthetic input.
if (P.mode === 'mirror' || P.mode === 'silhouette') startCamera();

// Expose for debugging / automation.
window.mirror = { P, sim, planner, bridge, camera, segmenter };
